/** 最小 node:test / assert 类型声明(避免为一个测试引入 @types/node 依赖) */
declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void
}

declare module 'node:assert/strict' {
  interface Assert {
    ok(value: unknown, message?: string): void
    equal(actual: unknown, expected: unknown, message?: string): void
    notEqual(actual: unknown, expected: unknown, message?: string): void
    deepEqual(actual: unknown, expected: unknown, message?: string): void
  }
  const assert: Assert
  export default assert
}
