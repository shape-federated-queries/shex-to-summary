import { describe, it, expect } from 'vitest';
import { inspect } from 'util';
import {
  handleNodeConstraint,
  handleShape,
  handleShapeAnd,
  handleShapeOr,
  mergeKg,
  mergeUnionKg,
  quadToString,
  shex_to_summary,
} from '../lib/shex_to_summary';
import type { NodeConstraint, ShapeOr, Shape, valueSetValue, ShapeDecl, ShapeAnd } from 'shexj';
import { DataFactory } from 'rdf-data-factory';
import type * as RDF from '@rdfjs/types';
import { isomorphic } from 'rdf-isomorphic';
import * as Shex from '@shexjs/parser';
import { isResult, type IResult } from 'result-interface';
import { Kind, type ISummary, type IKGConstraint } from '../lib/types';

const DF = new DataFactory<RDF.Quad>();
const SHEX_PARSER = Shex.construct('');

function termToString(term: RDF.Term): string {
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.termType === 'Literal') return `"${term.value}"`;
  return term.value;
}

function kgToString(quads: RDF.Quad[]): string {
  if (quads.length === 0) return '  (empty)';
  return quads
    .map(
      (q) =>
        `  ${termToString(q.subject)} ${termToString(q.predicate)} ${termToString(q.object)} .`,
    )
    .join('\n');
}

describe(handleNodeConstraint.name, () => {
  const subject = DF.namedNode('s');
  const predicate = DF.namedNode('p');
  const expectedQuads: [RDF.Quad] = [
    DF.quad(subject, predicate, DF.blankNode(`${subject.value}-${predicate.value}`)),
  ];

  it('returns empty KG given empty NodeConstraint', () => {
    const node: NodeConstraint = {
      type: 'NodeConstraint',
    };
    const kg = handleNodeConstraint(node, subject, predicate);

    expect(kg.constraints.size).toBe(1);
    expect(kg.constraints.get(quadToString(expectedQuads[0]))).toHaveLength(0);
    expect(kg.unionStatement).toHaveLength(0);
    expect(kg.statements).toEqual(expectedQuads);
  });

  it('returns KG with nodeKind constraint given NodeConstraint with nodeKind', () => {
    const node: NodeConstraint = {
      type: 'NodeConstraint',
      nodeKind: 'bnode',
    };
    const kg = handleNodeConstraint(node, subject, predicate);

    expect(kg.constraints.size).toBe(1);
    const constraints = kg.constraints.get(quadToString(expectedQuads[0]));
    expect(constraints).toHaveLength(1);
    expect(constraints![0]).toEqual({
      statement: expectedQuads[0],
      kind: Kind.NODE_KIND,
      constraint: 'bnode',
    });
    expect(kg.unionStatement).toHaveLength(0);
    expect(kg.statements).toEqual(expectedQuads);
  });

  it('returns KG with datatype constraint given NodeConstraint with datatype', () => {
    const node: NodeConstraint = {
      type: 'NodeConstraint',
      datatype: 'anIri',
    };
    const kg = handleNodeConstraint(node, subject, predicate);

    expect(kg.constraints.size).toBe(1);
    const constraints = kg.constraints.get(quadToString(expectedQuads[0]));
    expect(constraints).toHaveLength(1);
    expect(constraints![0]).toEqual({
      statement: expectedQuads[0],
      kind: Kind.DATA_TYPE,
      constraint: 'anIri',
    });
    expect(kg.unionStatement).toHaveLength(0);
    expect(kg.statements).toEqual(expectedQuads);
  });

  it('returns KG with value set constraint given NodeConstraint with values', () => {
    const values: valueSetValue[] = [
      'aaa',
      { type: 'IriStem', stem: 'aa' },
      { value: 'b', language: 'Frans', type: 'type' },
    ];
    const node: NodeConstraint = {
      type: 'NodeConstraint',
      values,
    };
    const kg = handleNodeConstraint(node, subject, predicate);

    expect(kg.constraints.size).toBe(1);
    const constraints = kg.constraints.get(quadToString(expectedQuads[0]));
    expect(constraints).toHaveLength(1);
    expect(constraints![0]).toEqual({
      statement: expectedQuads[0],
      kind: Kind.VALUE_SET,
      constraint: values,
    });
    expect(kg.unionStatement).toHaveLength(0);
    expect(kg.statements).toEqual(expectedQuads);
  });
});

describe(mergeUnionKg.name, () => {
  it('adds union triple linking two KGs given two valid KGs', () => {
    const prevKg: ISummary = {
      statements: [],
      unionStatement: [],
      constraints: new Map(),
    };
    const firstKg: ISummary = {
      statements: [
        DF.quad(DF.blankNode(), DF.namedNode('foo'), DF.blankNode()),
        DF.quad(DF.blankNode(), DF.namedNode('bar'), DF.blankNode()),
      ],
      unionStatement: [prevKg],
      constraints: new Map([
        [
          'a',
          [
            {
              statement: DF.quad(DF.blankNode(), DF.namedNode('foo'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'iri',
            },
          ],
        ],
      ]),
    };

    const otherKg: ISummary = {
      statements: [
        DF.quad(DF.blankNode(), DF.namedNode('foo1'), DF.blankNode()),
        DF.quad(DF.blankNode(), DF.namedNode('bar1'), DF.blankNode()),
      ],
      unionStatement: [],
      constraints: new Map([
        [
          'b',
          [
            {
              statement: DF.quad(DF.blankNode(), DF.namedNode('foo1'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'iri',
            },
          ],
        ],
      ]),
    };

    mergeUnionKg(firstKg, otherKg);

    expect(firstKg.unionStatement).toEqual([prevKg, otherKg]);
  });
});

describe(mergeKg.name, () => {
  it('combines quads from both KGs into one given two KGs', () => {
    const prevKg: ISummary = {
      statements: [],
      unionStatement: [],
      constraints: new Map(),
    };
    const firstKg: ISummary = {
      statements: [
        DF.quad(DF.blankNode(), DF.namedNode('foo'), DF.blankNode()),
        DF.quad(DF.blankNode(), DF.namedNode('bar'), DF.blankNode()),
      ],
      unionStatement: [prevKg],
      constraints: new Map([
        [
          'a',
          [
            {
              statement: DF.quad(DF.blankNode(), DF.namedNode('foo'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'iri',
            },
          ],
        ],
      ]),
    };

    const otherKg: ISummary = {
      statements: [
        DF.quad(DF.blankNode(), DF.namedNode('foo1'), DF.blankNode()),
        DF.quad(DF.blankNode(), DF.namedNode('bar1'), DF.blankNode()),
      ],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              statement: DF.quad(DF.blankNode(), DF.namedNode('foo1'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'iri',
            },
          ],
        ],
        [
          'b',
          [
            {
              statement: DF.quad(DF.blankNode(), DF.namedNode('foo1'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'iri',
            },
          ],
        ],
      ]),
    };

    mergeKg(firstKg, otherKg);

    const expectedStatement = [
      DF.quad(DF.blankNode(), DF.namedNode('foo'), DF.blankNode()),
      DF.quad(DF.blankNode(), DF.namedNode('bar'), DF.blankNode()),
      DF.quad(DF.blankNode(), DF.namedNode('foo1'), DF.blankNode()),
      DF.quad(DF.blankNode(), DF.namedNode('bar1'), DF.blankNode()),
    ];

    const expectedConstraints: Map<string, IKGConstraint[]> = new Map([
      [
        'a',
        [
          {
            statement: DF.quad(DF.blankNode(), DF.namedNode('foo'), DF.blankNode()),
            kind: Kind.NODE_KIND,
            constraint: 'iri',
          },
          {
            statement: DF.quad(DF.blankNode(), DF.namedNode('foo1'), DF.blankNode()),
            kind: Kind.NODE_KIND,
            constraint: 'iri',
          },
        ],
      ],
      [
        'b',
        [
          {
            statement: DF.quad(DF.blankNode(), DF.namedNode('foo1'), DF.blankNode()),
            kind: Kind.NODE_KIND,
            constraint: 'iri',
          },
        ],
      ],
    ]);

    expect(
      isomorphic(firstKg.statements, expectedStatement),
      `KGs are not isomorphic.\nActual:\n${kgToString(firstKg.statements)}\nExpected:\n${kgToString(expectedStatement)}`,
    ).toBe(true);
    expect(firstKg.unionStatement).toEqual([prevKg]);
    equalConstrainst(firstKg.constraints, expectedConstraints);
  });
});

describe(handleShape.name, () => {
  it('returns KG with predicate triples given shape with predicate-only expressions', () => {
    const subject = DF.namedNode('foo');

    const shapeString = `
      <http://a.example/S1> {
        <http://a.example/p1> [1 2];
        <http://a.example/p2> IRI;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);
    const shape: Shape = schema?.shapes![0]?.shapeExpr as Shape;
    expect(shape.type).toBe('Shape');
    const statements = [
      DF.quad(subject, DF.namedNode('http://a.example/p1'), DF.blankNode()),
      DF.quad(subject, DF.namedNode('http://a.example/p2'), DF.blankNode()),
    ];

    const firstConstraint: IKGConstraint = {
      statement: statements[0]!,
      kind: Kind.VALUE_SET,
      constraint: [
        {
          value: '1',
          type: 'http://www.w3.org/2001/XMLSchema#integer',
        },
        {
          value: '2',
          type: 'http://www.w3.org/2001/XMLSchema#integer',
        },
      ],
    };

    const secondConstraint: IKGConstraint = {
      statement: statements[1]!,
      kind: Kind.NODE_KIND,
      constraint: 'iri',
    };

    const expectedKg: ISummary = {
      statements,
      unionStatement: [],
      constraints: new Map([
        [quadToString(statements[0]!), [firstConstraint]],
        [quadToString(statements[1]!), [secondConstraint]],
      ]),
    };

    const resp = handleShape(shape, subject, new Map()) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    expect(resp.value.unionStatement).toHaveLength(0);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
  });

  it('returns KG with union triples given shape with oneOf predicate choices', () => {
    const subject = DF.namedNode('foo');

    const shapeString = `
      <http://a.example/S1> {
        (
           <http://a.example/name> LITERAL

          |
            <http://a.example/givenName> LITERAL+;
            <http://a.example/familyName> LITERAL
        );
        <http://a.example/mbox> IRI
      }`;
    const schema = SHEX_PARSER.parse(shapeString);
    const shape: Shape = schema?.shapes![0]?.shapeExpr as Shape;
    expect(shape.type).toBe('Shape');

    const statements = [DF.quad(subject, DF.namedNode('http://a.example/mbox'), DF.blankNode())];
    const unionStatement: ISummary[] = [
      {
        statements: [DF.quad(subject, DF.namedNode('http://a.example/name'), DF.blankNode())],
        unionStatement: [],
        constraints: new Map([
          [
            '1',
            [
              {
                statement: DF.quad(subject, DF.namedNode('http://a.example/name'), DF.blankNode()),
                kind: Kind.NODE_KIND,
                constraint: 'literal',
              },
            ],
          ],
        ]),
      },
      {
        statements: [
          DF.quad(subject, DF.namedNode('http://a.example/givenName'), DF.blankNode()),
          DF.quad(subject, DF.namedNode('http://a.example/familyName'), DF.blankNode()),
        ],
        unionStatement: [],
        constraints: new Map([
          [
            '1',
            [
              {
                statement: DF.quad(
                  subject,
                  DF.namedNode('http://a.example/givenName'),
                  DF.blankNode(),
                ),
                kind: Kind.NODE_KIND,
                constraint: 'literal',
              },
            ],
          ],
          [
            '2',
            [
              {
                statement: DF.quad(
                  subject,
                  DF.namedNode('http://a.example/familyName'),
                  DF.blankNode(),
                ),
                kind: Kind.NODE_KIND,
                constraint: 'literal',
              },
            ],
          ],
        ]),
      },
    ];

    const expectedKg: ISummary = {
      statements,
      unionStatement,
      constraints: new Map([
        [
          '1',
          [
            {
              statement: DF.quad(subject, DF.namedNode('http://a.example/mbox'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'iri',
            },
          ],
        ],
      ]),
    };

    const resp = handleShape(shape, subject, new Map()) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(2);
    for (const [i, kg] of resp.value.unionStatement.entries()) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      const expectedUnion = expectedKg.unionStatement[i]?.statements!;
      expect(
        isomorphic(kg.statements, expectedUnion),
        `Union KG[${i}] is not isomorphic.\nActual:\n${kgToString(kg.statements)}\nExpected:\n${kgToString(expectedUnion)}`,
      ).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      equalConstrainst(kg.constraints, expectedKg.unionStatement[i]?.constraints!);
    }
  });

  it('returns KG with nested shape references given shape with nested expressions', () => {
    const subject = DF.namedNode('foo');

    const shapeString = `
      PREFIX ex: <http://a.example/>

      ex:IssueShape {
      ex:state [ex:unassigned ex:assigned];
      ex:reportedBy {
        ex:name LITERAL;
        ex:mbox IRI+
      }
    }`;
    const schema = SHEX_PARSER.parse(shapeString);
    const shape: Shape = schema?.shapes![0]?.shapeExpr as Shape;
    expect(shape.type).toBe('Shape');
    const statements = [
      DF.quad(subject, DF.namedNode('http://a.example/state'), DF.blankNode()),
      DF.quad(
        subject,
        DF.namedNode('http://a.example/reportedBy'),
        DF.namedNode(`sub-${subject.value}`),
      ),
      DF.quad(
        DF.namedNode(`sub-${subject.value}`),
        DF.namedNode('http://a.example/name'),
        DF.blankNode(),
      ),
      DF.quad(
        DF.namedNode(`sub-${subject.value}`),
        DF.namedNode('http://a.example/mbox'),
        DF.blankNode(),
      ),
    ];

    const subSubject = DF.namedNode(`sub-${subject.value}`);
    const expectedKg: ISummary = {
      statements,
      unionStatement: [],
      constraints: new Map([
        [
          '1',
          [
            {
              statement: DF.quad(subject, DF.namedNode('http://a.example/state'), DF.blankNode()),
              kind: Kind.VALUE_SET,
              constraint: ['http://a.example/unassigned', 'http://a.example/assigned'],
            },
          ],
        ],
        [
          '2',
          [
            {
              statement: DF.quad(subSubject, DF.namedNode('http://a.example/name'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'literal',
            },
          ],
        ],
        [
          '3',
          [
            {
              statement: DF.quad(subSubject, DF.namedNode('http://a.example/mbox'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'iri',
            },
          ],
        ],
      ]),
    };

    const resp = handleShape(shape, subject, new Map()) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(0);
  });
});

describe(handleShapeOr.name, () => {
  it('returns union KG given ShapeOr with inline shape alternatives', () => {
    const subject = DF.namedNode('foo');

    const shapeString = `
      PREFIX ex: <http://example.org/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      ex:PersonShape {
        ex:email xsd:string ;
      } OR {
        ex:phone xsd:string ;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);
    const shape: ShapeOr = schema?.shapes![0]?.shapeExpr as ShapeOr;

    const expectedEmailBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedPhoneBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedKg: ISummary = {
      statements: [],
      unionStatement: [expectedEmailBranch, expectedPhoneBranch],
      constraints: new Map(),
    };

    const resp = handleShapeOr(shape, subject, new Map()) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(2);

    const respEmailBranch = resp.value.unionStatement[0]!;
    const respPhoneBranch = resp.value.unionStatement[1]!;
    for (const [branch, expectedBranch] of [
      [respEmailBranch, expectedEmailBranch],
      [respPhoneBranch, expectedPhoneBranch],
    ] as [ISummary, ISummary][]) {
      expect(
        isomorphic(branch.statements, expectedBranch.statements),
        `KGs are not isomorphic.\nActual:\n${kgToString(branch.statements)}\nExpected:\n${kgToString(expectedBranch.statements)}`,
      ).toBe(true);
      equalConstrainst(branch.constraints, expectedBranch.constraints);
      expect(branch.unionStatement).toHaveLength(0);
    }
  });

  it('returns union KG given ShapeOr with remote shape references', () => {
    const subject = DF.namedNode('foo');

    const shapeString = `
      PREFIX ex: <http://example.org/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      ex:PersonShape @ex:EmailShape OR @ex:PhoneShape

      ex:EmailShape {
        ex:email xsd:string ;
      }

      ex:PhoneShape {
        ex:phone xsd:string ;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);
    const availableShapes: Map<string, ShapeDecl> = new Map(
      schema?.shapes!.map((el) => [el.id, el]),
    );
    const shape: ShapeOr = schema?.shapes![0]?.shapeExpr as ShapeOr;

    const expectedEmailBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedPhoneBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedKg: ISummary = {
      statements: [],
      unionStatement: [expectedEmailBranch, expectedPhoneBranch],
      constraints: new Map(),
    };

    const resp = handleShapeOr(shape, subject, availableShapes) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(2);

    const respEmailBranch = resp.value.unionStatement[0]!;
    const respPhoneBranch = resp.value.unionStatement[1]!;
    for (const [branch, expectedBranch] of [
      [respEmailBranch, expectedEmailBranch],
      [respPhoneBranch, expectedPhoneBranch],
    ] as [ISummary, ISummary][]) {
      expect(
        isomorphic(branch.statements, expectedBranch.statements),
        `KGs are not isomorphic.\nActual:\n${kgToString(branch.statements)}\nExpected:\n${kgToString(expectedBranch.statements)}`,
      ).toBe(true);
      equalConstrainst(branch.constraints, expectedBranch.constraints);
      expect(branch.unionStatement).toHaveLength(0);
    }
  });
});

describe(handleShapeAnd.name, () => {
  it('returns merged KG given ShapeAnd with inline shape expressions', () => {
    const subject = DF.namedNode('foo');

    const shapeString = `
      PREFIX ex: <http://example.org/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      ex:PersonShape {
        ex:email xsd:string ;
      } AND {
        ex:phone xsd:string ;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);
    const shape: ShapeAnd = schema?.shapes![0]?.shapeExpr as ShapeAnd;

    const expectedEmailBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedPhoneBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'b',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedKg: ISummary = {
      statements: [...expectedEmailBranch.statements, ...expectedPhoneBranch.statements],
      unionStatement: [expectedEmailBranch, expectedPhoneBranch],
      constraints: new Map([
        ...expectedEmailBranch.constraints,
        ...expectedPhoneBranch.constraints,
      ]),
    };

    const resp = handleShapeAnd(shape, subject, new Map()) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(0);
  });

  it('returns merged KG given ShapeAnd with remote shape references', () => {
    const subject = DF.namedNode('foo');

    const shapeString = `
      PREFIX ex: <http://example.org/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      ex:PersonShape @ex:EmailShape AND @ex:PhoneShape

      ex:EmailShape {
        ex:email xsd:string ;
      }

      ex:PhoneShape {
        ex:phone xsd:string ;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);
    const availableShapes: Map<string, ShapeDecl> = new Map(
      schema?.shapes!.map((el) => [el.id, el]),
    );
    const shape: ShapeAnd = schema?.shapes![0]?.shapeExpr as ShapeAnd;

    const expectedEmailBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedPhoneBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'b',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedKg: ISummary = {
      statements: [...expectedEmailBranch.statements, ...expectedPhoneBranch.statements],
      unionStatement: [expectedEmailBranch, expectedPhoneBranch],
      constraints: new Map([
        ...expectedEmailBranch.constraints,
        ...expectedPhoneBranch.constraints,
      ]),
    };

    const resp = handleShapeAnd(shape, subject, availableShapes) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(0);
  });
});

describe(shex_to_summary.name, () => {
  it('converts ShEx with predicate-only shape to KG given simple shape', () => {
    const subject = DF.namedNode('http://a.example/S1');

    const shapeString = `
      <http://a.example/S1> {
        <http://a.example/p1> [1 2];
        <http://a.example/p2> IRI;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);
    const statements = [
      DF.quad(subject, DF.namedNode('http://a.example/p1'), DF.blankNode()),
      DF.quad(subject, DF.namedNode('http://a.example/p2'), DF.blankNode()),
    ];

    const firstConstraint: IKGConstraint = {
      statement: statements[0]!,
      kind: Kind.VALUE_SET,
      constraint: [
        {
          value: '1',
          type: 'http://www.w3.org/2001/XMLSchema#integer',
        },
        {
          value: '2',
          type: 'http://www.w3.org/2001/XMLSchema#integer',
        },
      ],
    };

    const secondConstraint: IKGConstraint = {
      statement: statements[1]!,
      kind: Kind.NODE_KIND,
      constraint: 'iri',
    };

    const expectedKg: ISummary = {
      statements,
      unionStatement: [],
      constraints: new Map([
        [quadToString(statements[0]!), [firstConstraint]],
        [quadToString(statements[1]!), [secondConstraint]],
      ]),
    };

    const resp = shex_to_summary(schema) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    expect(resp.value.unionStatement).toHaveLength(0);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
  });

  it('converts ShEx with choice predicates to KG given shape with oneOf predicate choices', () => {
    const subject = DF.namedNode('http://a.example/S1');

    const shapeString = `
      <http://a.example/S1> {
        (
           <http://a.example/name> LITERAL

          |
            <http://a.example/givenName> LITERAL+;
            <http://a.example/familyName> LITERAL
        );
        <http://a.example/mbox> IRI
      }`;
    const schema = SHEX_PARSER.parse(shapeString);

    const statements = [DF.quad(subject, DF.namedNode('http://a.example/mbox'), DF.blankNode())];
    const unionStatement: ISummary[] = [
      {
        statements: [DF.quad(subject, DF.namedNode('http://a.example/name'), DF.blankNode())],
        unionStatement: [],
        constraints: new Map([
          [
            '1',
            [
              {
                statement: DF.quad(subject, DF.namedNode('http://a.example/name'), DF.blankNode()),
                kind: Kind.NODE_KIND,
                constraint: 'literal',
              },
            ],
          ],
        ]),
      },
      {
        statements: [
          DF.quad(subject, DF.namedNode('http://a.example/givenName'), DF.blankNode()),
          DF.quad(subject, DF.namedNode('http://a.example/familyName'), DF.blankNode()),
        ],
        unionStatement: [],
        constraints: new Map([
          [
            '1',
            [
              {
                statement: DF.quad(
                  subject,
                  DF.namedNode('http://a.example/givenName'),
                  DF.blankNode(),
                ),
                kind: Kind.NODE_KIND,
                constraint: 'literal',
              },
            ],
          ],
          [
            '2',
            [
              {
                statement: DF.quad(
                  subject,
                  DF.namedNode('http://a.example/familyName'),
                  DF.blankNode(),
                ),
                kind: Kind.NODE_KIND,
                constraint: 'literal',
              },
            ],
          ],
        ]),
      },
    ];

    const expectedKg: ISummary = {
      statements,
      unionStatement,
      constraints: new Map([
        [
          '1',
          [
            {
              statement: DF.quad(subject, DF.namedNode('http://a.example/mbox'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'iri',
            },
          ],
        ],
      ]),
    };

    const resp = shex_to_summary(schema) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(2);
    for (const [i, kg] of resp.value.unionStatement.entries()) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      const expectedUnion = expectedKg.unionStatement[i]?.statements!;
      expect(
        isomorphic(kg.statements, expectedUnion),
        `Union KG[${i}] is not isomorphic.\nActual:\n${kgToString(kg.statements)}\nExpected:\n${kgToString(expectedUnion)}`,
      ).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      equalConstrainst(kg.constraints, expectedKg.unionStatement[i]?.constraints!);
    }
  });

  it('converts ShEx with nested shapes to KG given shape with nested references', () => {
    const subject = DF.namedNode('http://a.example/IssueShape');

    const shapeString = `
      PREFIX ex: <http://a.example/>

      ex:IssueShape {
      ex:state [ex:unassigned ex:assigned];
      ex:reportedBy {
        ex:name LITERAL;
        ex:mbox IRI+
      }
    }`;
    const schema = SHEX_PARSER.parse(shapeString);

    const statements = [
      DF.quad(subject, DF.namedNode('http://a.example/state'), DF.blankNode()),
      DF.quad(
        subject,
        DF.namedNode('http://a.example/reportedBy'),
        DF.namedNode(`sub-${subject.value}`),
      ),
      DF.quad(
        DF.namedNode(`sub-${subject.value}`),
        DF.namedNode('http://a.example/name'),
        DF.blankNode(),
      ),
      DF.quad(
        DF.namedNode(`sub-${subject.value}`),
        DF.namedNode('http://a.example/mbox'),
        DF.blankNode(),
      ),
    ];

    const subSubject = DF.namedNode(`sub-${subject.value}`);
    const expectedKg: ISummary = {
      statements,
      unionStatement: [],
      constraints: new Map([
        [
          '1',
          [
            {
              statement: DF.quad(subject, DF.namedNode('http://a.example/state'), DF.blankNode()),
              kind: Kind.VALUE_SET,
              constraint: ['http://a.example/unassigned', 'http://a.example/assigned'],
            },
          ],
        ],
        [
          '2',
          [
            {
              statement: DF.quad(subSubject, DF.namedNode('http://a.example/name'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'literal',
            },
          ],
        ],
        [
          '3',
          [
            {
              statement: DF.quad(subSubject, DF.namedNode('http://a.example/mbox'), DF.blankNode()),
              kind: Kind.NODE_KIND,
              constraint: 'iri',
            },
          ],
        ],
      ]),
    };

    const resp = shex_to_summary(schema) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(0);
  });

  it('converts ShEx with ShapeOr remote shapes to KG given remote shape references', () => {
    const subject = DF.namedNode('http://example.org/PersonShape');

    const shapeString = `
      PREFIX ex: <http://example.org/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      ex:PersonShape @ex:EmailShape OR @ex:PhoneShape

      ex:EmailShape {
        ex:email xsd:string ;
      }

      ex:PhoneShape {
        ex:phone xsd:string ;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);

    const expectedEmailBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedPhoneBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedKg: ISummary = {
      statements: [],
      unionStatement: [expectedEmailBranch, expectedPhoneBranch],
      constraints: new Map(),
    };

    const resp = shex_to_summary(schema) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement.length).toBe(2);

    const respEmailBranch = resp.value.unionStatement[0]!;
    const respPhoneBranch = resp.value.unionStatement[1]!;
    for (const [branch, expectedBranch] of [
      [respEmailBranch, expectedEmailBranch],
      [respPhoneBranch, expectedPhoneBranch],
    ] as [ISummary, ISummary][]) {
      expect(
        isomorphic(branch.statements, expectedBranch.statements),
        `KGs are not isomorphic.\nActual:\n${kgToString(branch.statements)}\nExpected:\n${kgToString(expectedBranch.statements)}`,
      ).toBe(true);
      equalConstrainst(branch.constraints, expectedBranch.constraints);
      expect(branch.unionStatement).toHaveLength(0);
    }
  });

  it('converts ShEx with ShapeOr inline shapes to KG given inline shape alternatives', () => {
    const subject = DF.namedNode('http://example.org/PersonShape');

    const shapeString = `
      PREFIX ex: <http://example.org/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      ex:PersonShape {
        ex:email xsd:string ;
      } OR {
        ex:phone xsd:string ;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);

    const expectedEmailBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedPhoneBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedKg: ISummary = {
      statements: [],
      unionStatement: [expectedEmailBranch, expectedPhoneBranch],
      constraints: new Map(),
    };

    const resp = shex_to_summary(schema) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(2);

    const respEmailBranch = resp.value.unionStatement[0]!;
    const respPhoneBranch = resp.value.unionStatement[1]!;
    for (const [branch, expectedBranch] of [
      [respEmailBranch, expectedEmailBranch],
      [respPhoneBranch, expectedPhoneBranch],
    ] as [ISummary, ISummary][]) {
      expect(
        isomorphic(branch.statements, expectedBranch.statements),
        `KGs are not isomorphic.\nActual:\n${kgToString(branch.statements)}\nExpected:\n${kgToString(expectedBranch.statements)}`,
      ).toBe(true);
      equalConstrainst(branch.constraints, expectedBranch.constraints);
      expect(branch.unionStatement).toHaveLength(0);
    }
  });

  it('converts ShEx with ShapeAnd inline shapes to KG given inline shape expressions', () => {
    const subject = DF.namedNode('http://example.org/PersonShape');

    const shapeString = `
      PREFIX ex: <http://example.org/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      ex:PersonShape {
        ex:email xsd:string ;
      } AND {
        ex:phone xsd:string ;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);
    const shape: ShapeAnd = schema?.shapes![0]?.shapeExpr as ShapeAnd;

    const expectedEmailBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedPhoneBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'b',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedKg: ISummary = {
      statements: [...expectedEmailBranch.statements, ...expectedPhoneBranch.statements],
      unionStatement: [expectedEmailBranch, expectedPhoneBranch],
      constraints: new Map([
        ...expectedEmailBranch.constraints,
        ...expectedPhoneBranch.constraints,
      ]),
    };

    const resp = handleShapeAnd(shape, subject, new Map()) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(0);
  });

  it('converts ShEx with ShapeAnd remote shapes to KG given remote shape references', () => {
    const subject = DF.namedNode('http://example.org/PersonShape');

    const shapeString = `
      PREFIX ex: <http://example.org/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      ex:PersonShape @ex:EmailShape AND @ex:PhoneShape

      ex:EmailShape {
        ex:email xsd:string ;
      }

      ex:PhoneShape {
        ex:phone xsd:string ;
      }`;
    const schema = SHEX_PARSER.parse(shapeString);

    const expectedEmailBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'a',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/email'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedPhoneBranch: ISummary = {
      statements: [DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode())],
      unionStatement: [],
      constraints: new Map([
        [
          'b',
          [
            {
              kind: Kind.DATA_TYPE,
              statement: DF.quad(subject, DF.namedNode('http://example.org/phone'), DF.blankNode()),
              constraint: 'http://www.w3.org/2001/XMLSchema#string',
            },
          ],
        ],
      ]),
    };

    const expectedKg: ISummary = {
      statements: [...expectedEmailBranch.statements, ...expectedPhoneBranch.statements],
      unionStatement: [expectedEmailBranch, expectedPhoneBranch],
      constraints: new Map([
        ...expectedEmailBranch.constraints,
        ...expectedPhoneBranch.constraints,
      ]),
    };

    const resp = shex_to_summary(schema) as IResult<ISummary>;

    expect(isResult(resp)).toBe(true);
    expect(
      isomorphic(resp.value.statements, expectedKg.statements),
      `KGs are not isomorphic.\nActual:\n${kgToString(resp.value.statements)}\nExpected:\n${kgToString(expectedKg.statements)}`,
    ).toBe(true);
    equalConstrainst(resp.value.constraints, expectedKg.constraints);
    expect(resp.value.unionStatement).toHaveLength(0);
  });
});

function equalConstrainst(
  first: Map<string, IKGConstraint[]>,
  second: Map<string, IKGConstraint[]>,
): void {
  const firstAll = [...first.values()].flat();
  const secondAll = [...second.values()].flat();

  expect(firstAll.length).toBe(secondAll.length);

  for (const constraint of firstAll) {
    const match = secondAll.find(
      (c) => isomorphic([constraint.statement], [c.statement]) && constraint.kind === c.kind,
    );
    expect(
      match,
      `No match found for constraint:\n${inspect(constraint, { depth: null })}\n\nAvailable in second:\n${inspect(secondAll, { depth: null })}`,
    ).toBeDefined();

    const firstIsArray = Array.isArray(constraint.constraint);
    const secondIsArray = Array.isArray(match!.constraint);
    expect(
      firstIsArray,
      `Constraint type mismatch for:\n${inspect(constraint, { depth: null })}\n\nMatched:\n${inspect(match, { depth: null })}`,
    ).toBe(secondIsArray);

    if (firstIsArray) {
      equalValueSets(
        constraint.constraint as valueSetValue[],
        match!.constraint as valueSetValue[],
      );
    } else {
      expect(constraint.constraint).toBe(match!.constraint);
    }
  }
}

function equalValueSets(first: valueSetValue[], second: valueSetValue[]): void {
  expect(first.length).toBe(second.length);
  for (const val of first) {
    expect(second).toContainEqual(val);
  }
}
