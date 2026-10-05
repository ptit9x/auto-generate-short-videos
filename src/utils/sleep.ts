/**
 * Promise-based sleep utility.
 * @param ms Milliseconds to wait
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
