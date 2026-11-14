// The WHATWG URL API exists in every runtime this package targets (Node ≥ 18, browsers), but the library
// tsconfig ships without DOM or Node types. Only the members used here are declared.
interface ZatmaUrlSearchParams {
  get(name: string): string | null;
  set(name: string, value: string): void;
  delete(name: string): void;
}
interface ZatmaUrl {
  readonly searchParams: ZatmaUrlSearchParams;
  readonly protocol: string;
  readonly hostname: string;
  toString(): string;
}
declare const URL: { new (url: string, base?: string): ZatmaUrl };
