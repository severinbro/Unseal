// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import { ApiError, type ErrorCode } from '@entsiegelung/shared';

export class BoundedSemaphore {
  public readonly maxConcurrent: number;
  public readonly maxQueue: number;
  public readonly overflowErrorCode: ErrorCode;
  private activeCount = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(
    maxConcurrent: number,
    maxQueue: number,
    overflowErrorCode: ErrorCode = 'SERVICE_UNAVAILABLE',
  ) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('BoundedSemaphore maxConcurrent must be an integer >= 1.');
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0) {
      throw new Error('BoundedSemaphore maxQueue must be an integer >= 0.');
    }
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;
    this.overflowErrorCode = overflowErrorCode;
  }

  public get active(): number {
    return this.activeCount;
  }

  public get queued(): number {
    return this.waitQueue.length;
  }

  public async acquire(): Promise<() => void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount += 1;
      return this.createReleaseCallback();
    }

    if (this.waitQueue.length >= this.maxQueue) {
      throw new ApiError(
        503,
        this.overflowErrorCode,
        'Server is temporarily busy; please retry shortly.',
      );
    }

    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });

    return this.createReleaseCallback();
  }

  public async run<T>(task: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  private createReleaseCallback(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.waitQueue.shift();
      if (next) {
        next();
      } else {
        this.activeCount -= 1;
      }
    };
  }
}
