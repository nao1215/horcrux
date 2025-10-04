/**
 * Data multiplexing/demultiplexing for efficient space usage
 * When threshold equals total, distribute data evenly across horcruxes
 */

import { Readable, Transform, type Writable } from 'stream';

/**
 * Number of bytes to write to each stream before switching
 */
const BYTE_QUOTA = 100;

/**
 * Demultiplexer distributes data across multiple output streams
 * Uses round-robin distribution with fixed byte quota
 */
export class Demultiplexer {
  private outputs: Writable[];
  private currentIndex: number;
  private bytesWritten: number;
  private closed: boolean;

  /**
   * Create a new Demultiplexer
   * @param outputs Array of output streams to distribute data to
   */
  constructor(outputs: Writable[]) {
    if (outputs.length === 0) {
      throw new Error('At least one output stream required');
    }
    this.outputs = outputs;
    this.currentIndex = 0;
    this.bytesWritten = 0;
    this.closed = false;
  }

  /**
   * Write data to the current output stream
   * Switches to next stream after BYTE_QUOTA bytes
   * @param chunk Data to write
   * @returns Promise that resolves when write is complete
   */
  async write(chunk: Buffer): Promise<void> {
    if (this.closed) {
      throw new Error('Demultiplexer is closed');
    }

    let offset = 0;

    while (offset < chunk.length) {
      const remainingQuota = BYTE_QUOTA - this.bytesWritten;
      const bytesToWrite = Math.min(remainingQuota, chunk.length - offset);
      const slice = chunk.slice(offset, offset + bytesToWrite);

      // Write to current output
      await this.writeToStream(this.outputs[this.currentIndex], slice);

      offset += bytesToWrite;
      this.bytesWritten += bytesToWrite;

      // Switch to next output if quota reached
      if (this.bytesWritten >= BYTE_QUOTA) {
        this.currentIndex = (this.currentIndex + 1) % this.outputs.length;
        this.bytesWritten = 0;
      }
    }
  }

  /**
   * Helper to write to a stream and wait for drain if needed
   */
  private writeToStream(stream: Writable, chunk: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const canContinue = stream.write(chunk, (error) => {
        if (error) {
          reject(error);
        } else if (!canContinue) {
          stream.once('drain', resolve);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Close all output streams
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    // End all output streams
    await Promise.all(
      this.outputs.map(
        (output) =>
          new Promise<void>((resolve) => {
            output.end(() => resolve());
          })
      )
    );
  }

  /**
   * Create a Transform stream that demultiplexes input
   * @param outputs Array of output streams
   * @returns Transform stream
   */
  static createTransform(outputs: Writable[]): Transform {
    const demux = new Demultiplexer(outputs);

    return new Transform({
      async transform(chunk: Buffer, _encoding, callback): Promise<void> {
        try {
          await demux.write(chunk);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },

      async flush(callback): Promise<void> {
        try {
          await demux.close();
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }
    });
  }
}

/**
 * Multiplexer combines data from multiple input streams
 * Reads from inputs in round-robin fashion with fixed byte quota
 */
export class Multiplexer {
  private inputs: Readable[];
  private currentIndex: number;
  private bytesRead: number;
  private ended: boolean[];

  /**
   * Create a new Multiplexer
   * @param inputs Array of input streams to read from
   */
  constructor(inputs: Readable[]) {
    if (inputs.length === 0) {
      throw new Error('At least one input stream required');
    }
    this.inputs = inputs;
    this.currentIndex = 0;
    this.bytesRead = 0;
    this.ended = new Array(inputs.length).fill(false) as boolean[];
  }

  /**
   * Check if all input streams have ended
   */
  private allEnded(): boolean {
    return this.ended.every((e) => e);
  }

  /**
   * Read next chunk from the multiplexed inputs
   * @returns Next chunk of data or null if all streams ended
   */
  async read(): Promise<Buffer | null> {
    if (this.allEnded()) {
      return null;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    while (totalBytes < BYTE_QUOTA && !this.allEnded()) {
      // Skip ended streams
      if (this.ended[this.currentIndex]) {
        this.currentIndex = (this.currentIndex + 1) % this.inputs.length;
        this.bytesRead = 0;
        continue;
      }

      const remainingQuota = BYTE_QUOTA - this.bytesRead;
      const chunk = this.inputs[this.currentIndex].read(remainingQuota) as Buffer | null;

      if (chunk === null) {
        // No data available right now, wait for it
        await new Promise((resolve) => {
          this.inputs[this.currentIndex].once('readable', resolve);
          this.inputs[this.currentIndex].once('end', () => {
            this.ended[this.currentIndex] = true;
            resolve(undefined);
          });
        });
        continue;
      }

      chunks.push(chunk);
      totalBytes += chunk.length;
      this.bytesRead += chunk.length;

      // Switch to next input if quota reached
      if (this.bytesRead >= BYTE_QUOTA) {
        this.currentIndex = (this.currentIndex + 1) % this.inputs.length;
        this.bytesRead = 0;
      }
    }

    return chunks.length > 0 ? Buffer.concat(chunks) : null;
  }

  /**
   * Create a Readable stream that multiplexes inputs
   * @param inputs Array of input streams
   * @returns Readable stream
   */
  static createReadable(inputs: Readable[]): Readable {
    const mux = new Multiplexer(inputs);

    return new Readable({
      async read(): Promise<void> {
        try {
          const chunk = await mux.read();
          this.push(chunk);
        } catch (error) {
          this.destroy(error as Error);
        }
      }
    });
  }
}

/**
 * Simple passthrough for non-multiplexed data
 * Used when threshold < total
 */
export class SimpleDistributor {
  /**
   * Distribute the same data to all outputs
   * @param data Data to distribute
   * @param outputs Array of output streams
   */
  static async distribute(data: Buffer, outputs: Writable[]): Promise<void> {
    await Promise.all(
      outputs.map(
        (output) =>
          new Promise<void>((resolve, reject) => {
            output.end(data, (error?: Error | null) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          })
      )
    );
  }

  /**
   * Create a Transform stream that copies input to all outputs
   * @param outputs Array of output streams
   * @returns Transform stream
   */
  static createTransform(outputs: Writable[]): Transform {
    const chunks: Buffer[] = [];

    return new Transform({
      transform(chunk: Buffer, _encoding, callback): void {
        chunks.push(chunk);
        callback();
      },

      async flush(callback): Promise<void> {
        try {
          const data = Buffer.concat(chunks);
          await SimpleDistributor.distribute(data, outputs);
          callback();
        } catch (error) {
          callback(error as Error);
        }
      }
    });
  }
}
