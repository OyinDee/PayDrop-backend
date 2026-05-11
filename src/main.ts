import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import * as bodyParser from 'body-parser';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Capture raw body for webhook signature validation
  app.use(
    bodyParser.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  app.enableCors();

  app.setGlobalPrefix('api/v1');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('PayDrop API')
    .setDescription('Peer-to-peer payment platform with OTP authentication, BLE discovery, and fraud pre-scoring')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-device-id',
        in: 'header',
        description: 'Device identifier header (required for protected endpoints)',
      },
      'deviceId',
    )
    .addSecurityRequirements('bearer')
    .addSecurityRequirements('deviceId')
    .addTag('Auth', 'Phone OTP-based authentication')
    .addTag('Users', 'User profiles and wallets')
    .addTag('Discovery', 'BLE and QR code discovery')
    .addTag('Transactions', 'Payment processing and history')
    .addTag('Notifications', 'Notification management')
    .addTag('Webhooks', 'Squad webhook receiver')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`PayDrop API is running on http://localhost:${port}`);
  console.log(`Swagger docs available at http://localhost:${port}/docs`);
}

bootstrap();
