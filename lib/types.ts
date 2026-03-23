import type * as RDF from '@rdfjs/types';
import type { ShapeDecl, nodeKind, IRIREF, valueSetValue } from 'shexj';

export interface ISummary {
  statements: RDF.Quad[];
  unionStatement: ISummary[];
  constraints: Map<string, IKGConstraint[]>;
}

export type IKGConstraint = {
  statement: RDF.Quad;
} & (
  | {
    kind: Kind.NODE_KIND;
    constraint: nodeKind;
  }
  | {
    kind: Kind.IRI_REF;
    constraint: IRIREF;
  }
  | {
    kind: Kind.DATA_TYPE;
    constraint: IRIREF;
  }
  | {
    kind: Kind.VALUE_SET;
    constraint: valueSetValue[];
  }
);

export enum Kind {
  NODE_KIND,
  IRI_REF,
  DATA_TYPE,
  VALUE_SET,
}

export interface IShapeTreeNode {
  id: string;
  shape: ShapeDecl;
  children: IShapeTreeNode[];
  relation?: 'OR' | 'AND';
}
