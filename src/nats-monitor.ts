import { connect, consumerOpts, StringCodec, DeliverPolicy, type NatsConnection } from 'nats';

export interface NatsEvent {
  id: number;
  ts: number;
  subject: string;
  data: unknown;
}

const BUFFER_SIZE = parseInt(process.env.NATS_BUFFER_SIZE || '500', 10);

const events: NatsEvent[] = [];
let eventCounter = 0;
let nc: NatsConnection | undefined;
let connected = false;

export function getEvents(afterId: number, subjectFilter?: string): NatsEvent[] {
  let result = events.filter((e) => e.id > afterId);
  if (subjectFilter) {
    const regex = new RegExp(
      '^' + subjectFilter.replace(/\./g, '\\.').replace(/\*/g, '[^.]+').replace(/>/g, '.+') + '$',
    );
    result = result.filter((e) => regex.test(e.subject));
  }
  return result;
}

export function isNatsConnected(): boolean {
  return connected;
}

export async function startNatsMonitor(): Promise<void> {
  const natsUrl = process.env.NATS_URL;
  if (!natsUrl) {
    console.log('NATS_URL not set — NATS monitor disabled');
    return;
  }

  const stream = process.env.NATS_STREAM || 'VISIOBOOK_PROJECT';
  const subject = process.env.NATS_SUBJECT || 'visiobook.>';
  const maxRetries = 10;
  const baseDelay = 2000;
  const sc = StringCodec();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      nc = await connect({
        servers: natsUrl,
        user: process.env.NATS_USER || undefined,
        pass: process.env.NATS_PASSWORD || undefined,
      });
      connected = true;
      console.log(`NATS monitor connected to ${natsUrl}`);

      const js = nc.jetstream();

      // Use an ordered consumer — ephemeral, read-only, doesn't interfere with real consumers
      const opts = consumerOpts();
      opts.orderedConsumer();
      opts.deliverNew();
      opts.filterSubject(subject);
      opts.bindStream(stream);

      const sub = await js.subscribe(subject, opts);
      console.log(`NATS monitor subscribed to ${subject} on stream ${stream}`);

      void (async () => {
        for await (const msg of sub) {
          eventCounter++;
          let data: unknown;
          try {
            data = JSON.parse(sc.decode(msg.data));
          } catch {
            data = sc.decode(msg.data);
          }
          events.push({
            id: eventCounter,
            ts: Date.now(),
            subject: msg.subject,
            data,
          });
          while (events.length > BUFFER_SIZE) {
            events.shift();
          }
        }
      })();

      // Monitor connection status
      void (async () => {
        for await (const s of nc!.status()) {
          if (s.type === 'disconnect' || s.type === 'error') {
            connected = false;
            console.warn(`NATS monitor: ${s.type}`, s.data);
          } else if (s.type === 'reconnect') {
            connected = true;
            console.log('NATS monitor reconnected');
          }
        }
      })();

      return;
    } catch (error) {
      console.warn(
        `NATS monitor connect attempt ${attempt}/${maxRetries} failed: ${(error as Error).message}`,
      );
      connected = false;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, baseDelay * attempt));
      }
    }
  }
  console.error('NATS monitor failed to connect after all retries');
}
