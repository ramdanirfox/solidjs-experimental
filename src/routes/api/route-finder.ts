import { json } from "@solidjs/router";
import { type APIEvent } from "@solidjs/start/server";

// Handler untuk GET request
export async function GET({ request }: APIEvent) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

//   return new Response(JSON.stringify({ message: `Mengambil data rute ${id}` }), {
//     headers: { "Content-Type": "application/json" }
//   });
    return json({ hello: "world" });
}