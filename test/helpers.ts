/** Fails with a clear message when the work hangs, instead of stalling the run. */
export function within<T>(ms: number, work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hang = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} hung for more than ${ms / 1000}s`)), ms);
  });
  return Promise.race([work, hang]).finally(() => clearTimeout(timer));
}
