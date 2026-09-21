declare module 'cloudflare:workers' { export const env: Record<string, any>; }
type D1Database = any;
interface Fetcher { fetch(request: Request): Promise<Response>; }
