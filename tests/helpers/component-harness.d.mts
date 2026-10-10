// Controlled hooks evaluate actual component callbacks without a browser.
export function harness(modules?: Record<string, unknown>): {
  load(path: string): Record<string, (props: any) => any>;
  cells: any[];
  effects: Array<() => void | (() => void)>;
  context: any;
  render(component: (props: any) => any, props: any): any;
};
export function nodes(tree: any): any[];
export function nodeOf(tree: any, type: string): any;
export function textOf(tree: any): string;
export function settle(): Promise<void>;
