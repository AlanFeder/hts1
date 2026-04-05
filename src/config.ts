import "dotenv/config";

export const config = {
	googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT ?? "project-misc-1",
	googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
	generationModel: process.env.GENERATION_MODEL ?? "gemini-2.5-flash-lite",
	embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-005",
	beamWidth: parseInt(process.env.BEAM_WIDTH ?? "3", 10),
	htsProcessedPath: process.env.HTS_PROCESSED_PATH ?? "data/hts_processed.json",
	htsRawPath: process.env.HTS_RAW_PATH ?? "data/hts_raw.json",
	port: parseInt(process.env.PORT ?? "3000", 10),
} as const;
