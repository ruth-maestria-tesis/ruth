import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Required with no default: a deploy that forgets it must fail at startup instead of
  // silently running in development mode (which enables Swagger).
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
  PORT: Joi.number().default(3001),
  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  CLIENT_URL: Joi.string().uri().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().positive().default(900),
  JWT_REFRESH_TTL_DAYS: Joi.number().integer().positive().default(7),
  COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
  /** RF-J14 link lifetime. */
  EXTERNAL_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(365).default(60),
  /** Access-cookie lifetime of an external-juror session (no refresh token). */
  EXTERNAL_SESSION_TTL_SECONDS: Joi.number()
    .integer()
    .min(300)
    .max(86_400)
    .default(14_400),
});
