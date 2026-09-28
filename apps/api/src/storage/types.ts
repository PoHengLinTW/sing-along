/** Object storage the API talks to (R2 in prod, RustFS in dev). Extended in M1-05. */
export interface Storage {
  deleteObjects(keys: string[]): Promise<void>;
}
