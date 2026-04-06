import type { ClassifyRequest, ClassifyResponse } from "./types";

export async function classify(
	req: ClassifyRequest,
): Promise<ClassifyResponse> {
	const res = await fetch("/classify", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(req),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new Error(`${res.status}: ${text}`);
	}
	return res.json() as Promise<ClassifyResponse>;
}
