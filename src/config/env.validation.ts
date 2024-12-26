import { plainToClass } from 'class-transformer';
import { IsEnum, IsNumber, IsString, validateSync, IsOptional } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
  Staging = 'staging'
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsNumber()
  PORT: number;

  @IsString()
  HOST: string;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @IsOptional()
  DATABASE_SSL?: string;

  @IsString()
  JWT_SECRET: string;

  @IsNumber()
  JWT_EXPIRATION_TIME: number;

  @IsString()
  @IsOptional()
  REDIS_URL?: string;

  @IsString()
  @IsOptional()
  CORS_ORIGIN?: string;

  @IsNumber()
  @IsOptional()
  RATE_LIMIT_TTL?: number;

  @IsNumber()
  @IsOptional()
  RATE_LIMIT_MAX?: number;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(
    EnvironmentVariables,
    config,
    { enableImplicitConversion: true },
  );
  
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  
  return validatedConfig;
}