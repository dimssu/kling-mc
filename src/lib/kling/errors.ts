export type KlingServiceCode =
  | 0
  | 1000 | 1001 | 1002 | 1003 | 1004
  | 1100 | 1101 | 1102 | 1103
  | 1200 | 1201 | 1202 | 1203
  | 1300 | 1301 | 1302 | 1303 | 1304
  | 5000 | 5001 | 5002;

const RETRYABLE: ReadonlySet<number> = new Set([1003, 1004, 1302, 1303, 5000, 5001, 5002]);
const USER_FACING: ReadonlySet<number> = new Set([
  1101, 1102, 1103, 1200, 1201, 1203, 1300, 1301, 1304,
]);
const TOKEN_REFRESH: ReadonlySet<number> = new Set([1003, 1004]);

export function isRetryable(code: number | undefined | null): boolean {
  return code != null && RETRYABLE.has(code);
}

export function isUserFacing(code: number | undefined | null): boolean {
  return code != null && USER_FACING.has(code);
}

export function shouldRefreshToken(code: number | undefined | null): boolean {
  return code != null && TOKEN_REFRESH.has(code);
}

export class KlingApiError extends Error {
  constructor(
    public readonly code: number,
    public readonly httpStatus: number,
    message: string,
    public readonly requestId?: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "KlingApiError";
  }

  get retryable(): boolean {
    return isRetryable(this.code) || this.httpStatus >= 500;
  }

  get userFacing(): boolean {
    return isUserFacing(this.code);
  }
}
