import { MediaController } from './media.controller';

/** Per-IP ceiling for the content route; see `mediaContentIp` in AppModule. */
export function mediaContentIpLimit(): number {
  return process.env.NODE_ENV === 'test' ? 10_000 : 600;
}

/** `mediaContentIp` applies to `MediaController.getContent` only. */
export function isNotMediaContentRoute(context: {
  getClass(): unknown;
  getHandler(): unknown;
}): boolean {
  return (
    context.getClass() !== MediaController ||
    context.getHandler() !==
      Object.getOwnPropertyDescriptor(MediaController.prototype, 'getContent')
        ?.value
  );
}
