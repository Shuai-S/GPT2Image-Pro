import { logApiResponse, logError } from "./logger/index";

export function withApiLogging<T extends (...args: never[]) => Promise<Response>>(
  handler: T
): T {
  const wrapped = async (...args: Parameters<T>) => {
    const request = args[0] as unknown as Request;
    const startTime = Date.now();
    try {
      const response = await handler(...args);
      logApiResponse(request, response, Date.now() - startTime);
      return response;
    } catch (error) {
      logError(error, {
        source: "api",
        method: request.method,
        path: new URL(request.url).pathname,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  };
  return wrapped as T;
}
