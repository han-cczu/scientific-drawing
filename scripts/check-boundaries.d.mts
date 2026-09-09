export type BoundaryViolation = { file: string; line: number; specifier: string; message: string };
export function checkBoundaries(rootDir?: string): BoundaryViolation[];
