import { z } from '@hono/zod-openapi';

const time = z.iso.datetime();
const point = z.object({ lat: z.number(), lon: z.number() });
const measurement = z.object({ value: z.number(), time, expiresAt: time });
const directionDegrees = z.number().min(0).max(360).optional();
const feelsLikeTemperature = z.number().optional();
const metrics = {
  temperature: measurement.extend({ feelsLikeTemperature }).optional(),
  wind: measurement.extend({ directionDegrees }).optional(),
  precipitation: measurement.optional()
};

export const parkWeatherSchema = z
  .object({
    observation: z
      .object({
        station: point.extend({
          id: z.string(),
          name: z.string(),
          distanceMetres: z.number().int()
        }),
        ...metrics
      })
      .optional(),
    forecast: z
      .object({
        point,
        modelRunTime: time,
        expiresAt: time,
        slots: z
          .array(
            z.object({
              time,
              temperature: z.number().optional(),
              feelsLikeTemperature,
              wind: z.number().optional(),
              windDirectionDegrees: directionDegrees,
              weatherSymbol: z.number().int().optional(),
              precipitation: z.number().optional()
            })
          )
          .max(4)
      })
      .optional()
  })
  .openapi('ParkWeather');

export type ParkWeather = z.infer<typeof parkWeatherSchema>;
