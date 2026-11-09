// Test environment: isolated database and Redis key prefix. Values can be overridden by CI env vars.
process.env.NODE_ENV = 'test';
process.env.PORT ??= '4100';
process.env.API_URL ??= 'http://localhost:4100';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://zatma:zatma@localhost:5432/zatma_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-123';
process.env.S3_BUCKET ??= 'zatma-test';
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';
process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
process.env.EMAIL_TRANSPORT = 'capture';
process.env.WEB_URL = 'http://localhost:3000';
process.env.TRIAL_PLAN = 'PROFESSIONAL';
process.env.TRIAL_DAYS = '14';
for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY']) delete process.env[k];
