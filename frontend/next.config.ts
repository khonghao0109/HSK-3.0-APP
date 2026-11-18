import type { NextConfig } from 'next';

import { MEDIA_UPLOAD_BFF_MAX_BYTES } from './src/features/media-upload/media-upload-values';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // M5.2a (V1): proxy đệm body tối đa 10 MB mặc định và cắt phần thừa; tải
    // media cần đủ tệp 10 MiB + phần bao multipart.
    proxyClientMaxBodySize: MEDIA_UPLOAD_BFF_MAX_BYTES,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
