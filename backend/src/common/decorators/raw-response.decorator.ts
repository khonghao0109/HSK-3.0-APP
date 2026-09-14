import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'rawResponse';

/**
 * Leaves a successful response unwrapped (binary or streamed bodies). Errors
 * from the route still use the JSON error envelope.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
