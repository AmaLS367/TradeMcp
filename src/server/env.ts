import { z } from 'zod';
import { logger } from './logger.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be exactly 64 characters long').regex(/^[0-9a-fA-F]+$/, 'ENCRYPTION_KEY must be a hex string'),
  FIREBASE_SERVICE_ACCOUNT_KEY: z.string().optional().refine((val) => {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
    return !!val;
  }, { message: 'Either FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS must be set' }),
  PUBLIC_BASE_URL: z.string().url().optional().or(z.literal('')),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let env: Env;

export function validateEnv(): Env {
  try {
    env = envSchema.parse(process.env);
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.issues.map(err => `${err.path.join('.')}: ${err.message}`).join('\n');
      console.error(`❌ Invalid environment variables:\n${missingVars}`);
    } else {
      console.error('❌ Unknown error during environment validation');
    }
    process.exit(1);
  }
}

export { env };
