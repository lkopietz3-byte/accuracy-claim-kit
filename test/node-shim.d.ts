// The tests run on Node but the project carries no @types/node. These are the
// only Node APIs the tests use.
declare const process: {
  env: Record<string, string | undefined>
  cpuUsage(previous?: { user: number; system: number }): { user: number; system: number }
}
declare module 'node:vm' {
  const vm: { runInNewContext(code: string): unknown }
  export default vm
}
