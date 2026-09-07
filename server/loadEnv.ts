import dotenv from 'dotenv';

dotenv.config();

const isTestProcess = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
if (process.env.NODE_ENV !== 'production' && !isTestProcess) {
  dotenv.config({ path: '.env.local', override: true });
}
