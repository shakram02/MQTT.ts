import { BaseClient, BaseClientOptions } from './base.ts';
import * as log from 'https://deno.land/std/log/mod.ts';
import { Logger, LogRecord } from 'https://deno.land/std/log/logger.ts';
import { LevelName } from 'https://deno.land/std/log/levels.ts';

export type ClientOptions = BaseClientOptions & {
  logger?: Logger;
};

const DEFAULT_BUF_SIZE = 4096;

export class Client extends BaseClient {
  private conn: Deno.Conn | undefined;
  private closing = false;
  private logger: Logger;

  constructor(options: ClientOptions) {
    super(options);

    this.logger = options.logger || log.getLogger();
  }

  protected async open() {
    const conn = await Deno.connect({
      hostname: this.options.host || 'localhost',
      port: this.options.port || 1883,
    });

    this.conn = conn;
    this.closing = false;

    // This loops forever (until the connection is closed) so it gets invoked
    // without `await` so it doesn't block opening the connection.
    (async () => {
      const buffer = new Uint8Array(DEFAULT_BUF_SIZE);

      while (true) {
        let bytesRead = null;

        try {
          this.log('reading');

          bytesRead = await conn.read(buffer);
        } catch (err) {
          if (this.closing && err.name === 'BadResource') {
            // Not sure why this exception gets thrown after closing the
            // connection. See my issue at
            // https://github.com/denoland/deno/issues/5194.
          } else {
            this.log('caught error while reading', err);

            this.connectionClosed();
          }

          break;
        }

        if (bytesRead === null) {
          this.log('read stream closed');

          this.connectionClosed();

          break;
        }

        this.bytesReceived(buffer.slice(0, bytesRead));
      }
    })().then(
      () => {},
      () => {}
    );
  }

  protected async write(bytes: Uint8Array) {
    if (!this.conn) {
      throw new Error('no connection');
    }

    this.log('writing bytes', bytes);

    await this.conn.write(bytes);
  }

  protected async close() {
    if (!this.conn) {
      throw new Error('no connection');
    }

    this.closing = true;

    this.conn.close();
  }

  protected log(msg: string, ...args: unknown[]) {
    this.logger.debug(msg, ...args);
  }
}

export async function setupLogger(levelName: LevelName) {
  await log.setup({
    handlers: {
      mqtt: new log.handlers.ConsoleHandler(levelName, {
        formatter: (logRecord: LogRecord) => {
          let output = `${logRecord.levelName} ${logRecord.msg}`;

          const args = logRecord.args;

          if (args.length > 0) {
            for (const arg of args) {
              if (arg instanceof Uint8Array) {
                output +=
                  ' ' +
                  [...arg]
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join(' ');
              } else if (typeof arg === 'object') {
                output += ' ' + Deno.inspect(arg);
              }
            }
          }

          return output;
        },
      }),
    },
    loggers: {
      mqtt: {
        level: levelName,
        handlers: ['mqtt'],
      },
    },
  });

  return log.getLogger('mqtt');
}
