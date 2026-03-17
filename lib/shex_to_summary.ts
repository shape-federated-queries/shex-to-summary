import type * as RDF from '@rdfjs/types';
import type {
  Schema,
  TripleConstraint,
  Shape,
  ShapeDecl,
  ShapeOr,
  shapeExpr,
  ShapeAnd,
  EachOf,
  OneOf,
  tripleExprOrRef,
  shapeExprOrRef,
  NodeConstraint,
} from 'shexj';
import { DataFactory } from 'rdf-data-factory';
import { error, isError, result, type Result } from 'result-interface';
import { Kind } from './types';
import type { ISummary, IKGConstraint, IShapeTreeNode } from './types';

const DF = new DataFactory<RDF.Quad>();

/**
 * Convert a ShEx schema into a knowledge graph.
 * We suppose that no shape have to be imported and every shapes are closed.
 * @param {Schema} schema A ShEx schema.
 * @returns {Result<ISummary, string>} The resulting knowledge graph.
 */
export function shex_to_summary(schema: Schema): Result<ISummary, string> {
  const kg: ISummary = {
    statements: [],
    unionStatement: [],
    constraints: new Map(),
  };

  if (schema.shapes === undefined) {
    return result(kg);
  }
  const availableShapes: Map<string, ShapeDecl> = new Map(schema.shapes.map((el) => [el.id, el]));
  const rootNodesResp = shex_to_shape_tree(schema);
  if (isError(rootNodesResp)) {
    return rootNodesResp;
  }

  for (const shape of rootNodesResp.value) {
    const res = shape_to_summary(shape.shape, availableShapes);
    if (isError(res)) {
      return res;
    }
    mergeKg(kg, res.value);
  }

  return result(kg);
}

/**
 * Convert a shape to a knowledge graph.
 * @param {ShapeDecl} shape A shape to convert into a kg.
 * @param {Map<string, ShapeDecl>} availableShapes the shapes that are available in the schema
 * @returns {Result<ISummary, string>} - The resulting knowledge graph.
 */
function shape_to_summary(
  shape: ShapeDecl,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  const subject = DF.namedNode(shape.id);
  const kg = shape_to_kg_subject(shape, subject, availableShapes);
  return kg;
}

/**
 * Convert a shape to a knowledge graph.
 * @param {ShapeDecl} shape A shape to convert into a kg.
 * @param {RDF.NamedNode} subject The subject term of the main star pattern defined by the shape.
 * @param {Map<string, ShapeDecl>} availableShapes The shapes that are available in the schema.
 * @returns {Result<ISummary, string>} - The resulting knowledge graph.
 */
function shape_to_kg_subject(
  shape: ShapeDecl,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  if (shape.shapeExpr === undefined) {
    return result({
      statements: [],
      unionStatement: [],
      constraints: new Map(),
    });
  }
  return handleShapeExpression(shape.shapeExpr, subject, availableShapes);
}

export function quadToString(quad: RDF.Quad): string {
  return `${quad.subject.value}-${quad.predicate.value}-${quad.object.value}`;
}

/**
 * Convert a node constraint into a knowledge graph.
 * It does not handle when a NodeConstraint has multiple constraint because it should not happen.
 * @param {NodeConstraint} node A node constraint.
 * @param {RDF.NamedNode} subject The subject of the triple.
 * @param {RDF.NamedNode} predicate The predicate of the triple.
 * @returns {ISummary} - The resulting knowledge graph.
 */
export function handleNodeConstraint(
  node: NodeConstraint,
  subject: RDF.NamedNode,
  predicate: RDF.NamedNode,
): ISummary {
  const quad = DF.quad(subject, predicate, DF.blankNode(`${subject.value}-${predicate.value}`));
  const constraints: Map<string, IKGConstraint[]> = new Map();
  constraints.set(quadToString(quad), []);

  const entry = constraints.get(quadToString(quad))!;

  if (node.nodeKind !== undefined) {
    const nodeConstraint: IKGConstraint = {
      kind: Kind.NODE_KIND,
      statement: quad,
      constraint: node.nodeKind,
    };
    entry.push(nodeConstraint);
  } else if (node.datatype !== undefined) {
    const dataTypeConstraint: IKGConstraint = {
      statement: quad,
      kind: Kind.DATA_TYPE,
      constraint: node.datatype,
    };
    entry.push(dataTypeConstraint);
  } else if (node.values !== undefined) {
    const valueConstraint: IKGConstraint = {
      statement: quad,
      kind: Kind.VALUE_SET,
      constraint: node.values,
    };
    entry.push(valueConstraint);
  }

  const kg: ISummary = {
    statements: [quad],
    unionStatement: [],
    constraints,
  };

  return kg;
}

function handleShapeExpression(
  shape: shapeExpr,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
  predicate?: RDF.NamedNode,
): Result<ISummary, string> {
  switch (shape.type) {
    case 'NodeConstraint':
      if (predicate === undefined) {
        return error('');
      }
      return result(handleNodeConstraint(shape, subject, predicate));
    case 'Shape':
      return handleShape(shape, subject, availableShapes);
    case 'ShapeAnd':
      return handleShapeAnd(shape, subject, availableShapes);
    case 'ShapeOr':
      return handleShapeOr(shape, subject, availableShapes);
    case 'ShapeNot':
      return error('ShapeNot is not handled');
    case 'ShapeExternal':
      return error('ShapeExternal cannot be resolved');
  }
}

export function handleShape(
  shape: Shape,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  const kg: ISummary = {
    statements: [],
    unionStatement: [],
    constraints: new Map(),
  };
  // we are ignoring extra for now
  // we are ignoring extend for now
  if (shape.expression !== undefined) {
    const res = handleTripleExprOrRef(shape.expression, subject, availableShapes);
    if (isError(res)) return res;
    mergeKg(kg, res.value);
  }

  return result(kg);
}

function handleTripleExprOrRef(
  expr: tripleExprOrRef,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  if (typeof expr === 'string') {
    return error(`tripleExprRef '${expr}' is not supported`);
  }
  return handleTripleExpr(expr, subject, availableShapes);
}

function handleTripleExpr(
  expr: EachOf | OneOf | TripleConstraint,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  switch (expr.type) {
    case 'TripleConstraint':
      return handleTripleConstraint(expr, subject, availableShapes);
    case 'EachOf':
      return handleEachOf(expr, subject, availableShapes);
    case 'OneOf':
      return handleOneOf(expr, subject, availableShapes);
  }
}

function handleTripleConstraint(
  expr: TripleConstraint,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  if (expr.inverse === true) {
    return error(`inverse TripleConstraints are not supported (predicate: ${expr.predicate})`);
  }
  const predicate = DF.namedNode(expr.predicate);

  if (expr.valueExpr === undefined) {
    return result({
      statements: [DF.quad(subject, predicate, DF.blankNode())],
      unionStatement: [],
      constraints: new Map(),
    });
  }
  if (typeof expr.valueExpr === 'string') {
    return handleShapeDeclarationRef(expr.valueExpr, subject, predicate, availableShapes);
  }
  if (expr.valueExpr.type === 'NodeConstraint') {
    return handleShapeExpression(expr.valueExpr, subject, availableShapes, predicate);
  }

  const subSubject = DF.namedNode(`sub-${subject.value}`);
  const connectingTriple = DF.quad(subject, predicate, subSubject);
  const res = handleShapeExpression(expr.valueExpr, subSubject, availableShapes);
  if (isError(res)) {
    return res;
  }
  return result({
    statements: [connectingTriple, ...res.value.statements],
    unionStatement: res.value.unionStatement,
    constraints: res.value.constraints,
  });
}

function handleEachOf(
  expr: EachOf,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  const kg: ISummary = {
    statements: [],
    unionStatement: [],
    constraints: new Map(),
  };
  for (const sub of expr.expressions) {
    const res = handleTripleExprOrRef(sub, subject, availableShapes);
    if (isError(res)) {
      return res;
    }
    mergeKg(kg, res.value);
  }
  return result(kg);
}

function handleOneOf(
  expr: OneOf,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  const kg: ISummary = {
    statements: [],
    unionStatement: [],
    constraints: new Map(),
  };
  for (const sub of expr.expressions) {
    const res = handleTripleExprOrRef(sub, subject, availableShapes);
    if (isError(res)) return res;
    mergeUnionKg(kg, res.value);
  }
  return result(kg);
}

function handleShapeDeclarationRef(
  declaration: string,
  subject: RDF.NamedNode,
  predicate: RDF.NamedNode | undefined,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  //The expression is a constraint by a shape
  // Thus we get the shape and make a star shape sub KG
  const shape = availableShapes.get(declaration);
  if (shape === undefined) {
    return error(`shape ${declaration} is not an available shape`);
  }
  const subSubject = predicate === undefined ? subject : DF.namedNode(shape.id);
  const respSubKg = shape_to_kg_subject(shape, subSubject, availableShapes);
  if (isError(respSubKg)) {
    return respSubKg;
  }
  const statements: RDF.Quad[] = [];
  if (predicate !== undefined) {
    statements.push(DF.quad(subject, predicate, subSubject));
  }
  const kg: ISummary = {
    statements,
    unionStatement: [],
    constraints: new Map(),
  };
  mergeKg(kg, respSubKg.value);

  return result(kg);
}

export function handleShapeAnd(
  shape: ShapeAnd,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  return handleShapeOrAnd(shape, subject, availableShapes);
}

export function handleShapeOr(
  shape: ShapeOr,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  return handleShapeOrAnd(shape, subject, availableShapes);
}

function handleShapeOrAnd(
  shape: ShapeOr | ShapeAnd,
  subject: RDF.NamedNode,
  availableShapes: Map<string, ShapeDecl>,
): Result<ISummary, string> {
  const mergeFunction: (mergeableKg: ISummary, otherKg: ISummary) => void = isShapeOr(shape)
    ? mergeUnionKg
    : mergeKg;

  const kg: ISummary = {
    statements: [],
    unionStatement: [],
    constraints: new Map(),
  };
  for (const expression of shape.shapeExprs) {
    const resultKg: Result<ISummary, string> = isShapeExpression(expression)
      ? handleShapeExpression(expression, subject, availableShapes)
      : handleShapeDeclarationRef(expression, subject, undefined, availableShapes);
    if (isError(resultKg)) {
      return resultKg;
    }
    mergeFunction(kg, resultKg.value);
  }
  return result(kg);
}

function isShapeExpression(entity: shapeExprOrRef): entity is shapeExpr {
  if (typeof entity === 'string') {
    return false;
  }
  return (
    entity.type === 'Shape' ||
    entity.type === 'ShapeOr' ||
    entity.type === 'ShapeAnd' ||
    entity.type === 'ShapeNot'
  );
}
export function mergeKg(mergeableKg: ISummary, otherKg: ISummary): void {
  mergeableKg.statements = mergeableKg.statements.concat(otherKg.statements);
  mergeableKg.unionStatement = mergeableKg.unionStatement.concat(otherKg.unionStatement);
  for (const [key, constraint] of otherKg.constraints) {
    const mergeableKgConstraint = mergeableKg.constraints.get(key);
    if (mergeableKgConstraint) {
      mergeableKgConstraint.push(...constraint);
    } else {
      mergeableKg.constraints.set(key, constraint);
    }
  }
}

export function mergeUnionKg(mergeableKg: ISummary, otherKg: ISummary): void {
  mergeableKg.unionStatement.push(otherKg);
}

function isShapeOr(shape: ShapeOr | ShapeAnd): shape is ShapeOr {
  return shape.type === 'ShapeOr';
}

/**
 * Build a forest of shape trees from a ShEx schema.
 * Each top-level ShapeDecl becomes a root node. Children are created for shapes
 * referenced via ShapeOr or ShapeAnd. Inline shape expressions are not expanded as nodes.
 * @param {Schema} schema A ShEx schema.
 * @returns {Result<IShapeTreeNode[], string>} The resulting forest of shape trees.
 */
function shex_to_shape_tree(schema: Schema): Result<IShapeTreeNode[], string> {
  if (schema.shapes === undefined) {
    return result([]);
  }

  const availableShapes: Map<string, ShapeDecl> = new Map(schema.shapes.map((el) => [el.id, el]));
  const trees: IShapeTreeNode[] = [];

  for (const shape of schema.shapes) {
    const res = buildShapeTree(shape, availableShapes, new Set());
    if (isError(res)) {
      return res;
    }
    trees.push(res.value);
  }

  const nestedIds = new Set<string>();
  collectNestedIds(trees, nestedIds);

  return result(trees.filter((node) => !nestedIds.has(node.id)));
}

function collectNestedIds(nodes: IShapeTreeNode[], nestedIds: Set<string>): void {
  for (const node of nodes) {
    for (const child of node.children) {
      nestedIds.add(child.id);
      collectNestedIds(child.children, nestedIds);
    }
  }
}

function buildShapeTree(
  shapeDecl: ShapeDecl,
  availableShapes: Map<string, ShapeDecl>,
  visited: Set<string>,
  relation?: 'OR' | 'AND',
): Result<IShapeTreeNode, string> {
  const id = shapeDecl.id;

  if (visited.has(id)) {
    return result({ id, shape: shapeDecl, children: [], relation });
  }

  visited.add(id);

  const expr = shapeDecl.shapeExpr;

  if (expr === undefined || (expr.type !== 'ShapeOr' && expr.type !== 'ShapeAnd')) {
    return result({ id, shape: shapeDecl, children: [], relation });
  }

  const childRelation: 'OR' | 'AND' = expr.type === 'ShapeOr' ? 'OR' : 'AND';
  const children: IShapeTreeNode[] = [];

  for (const subExpr of expr.shapeExprs) {
    if (typeof subExpr !== 'string') {
      continue;
    }

    const childDecl = availableShapes.get(subExpr);
    if (childDecl === undefined) {
      return error(`shape ${subExpr} is not an available shape`);
    }

    const childRes = buildShapeTree(childDecl, availableShapes, visited, childRelation);
    if (isError(childRes)) {
      return childRes;
    }
    children.push(childRes.value);
  }

  return result({ id, shape: shapeDecl, children, relation });
}
