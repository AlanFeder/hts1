import { useState } from "react";
import { classify } from "../api";
import type { ClassifyRequest, ClassifyResponse } from "../types";
import ClassifyForm from "./ClassifyForm";
import IntermediatesPanel from "./intermediates/IntermediatesPanel";
import ResultsTable from "./ResultsTable";

type State =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "success"; data: ClassifyResponse }
	| { status: "error"; message: string };

export default function SingleView() {
	const [state, setState] = useState<State>({ status: "idle" });

	async function handleSubmit(req: ClassifyRequest) {
		setState({ status: "loading" });
		try {
			const data = await classify(req);
			setState({ status: "success", data });
		} catch (err) {
			setState({
				status: "error",
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return (
		<div className="space-y-6">
			{/* Form card */}
			<div className="card p-6">
				<h2 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
					<span className="w-6 h-6 rounded bg-navy-700 text-white flex items-center justify-center text-xs font-bold">
						1
					</span>
					Enter Product Details
				</h2>
				<ClassifyForm
					onSubmit={handleSubmit}
					loading={state.status === "loading"}
				/>
			</div>

			{/* Loading */}
			{state.status === "loading" && (
				<div className="card p-12 flex flex-col items-center gap-3 text-slate-400">
					<svg
						aria-hidden="true"
						className="animate-spin w-8 h-8 text-blue-500"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle
							className="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							strokeWidth="4"
						/>
						<path
							className="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
						/>
					</svg>
					<p className="text-sm">Classifying…</p>
				</div>
			)}

			{/* Error */}
			{state.status === "error" && (
				<div className="card p-5 border-red-200 bg-red-50">
					<p className="text-sm font-semibold text-red-700">
						Classification failed
					</p>
					<p className="text-sm text-red-600 mt-1 font-mono">{state.message}</p>
				</div>
			)}

			{/* Results */}
			{state.status === "success" && (
				<>
					<div className="card p-6">
						<h2 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
							<span className="w-6 h-6 rounded bg-navy-700 text-white flex items-center justify-center text-xs font-bold">
								2
							</span>
							Classification Results
						</h2>
						<ResultsTable response={state.data} />
					</div>

					<div className="card p-6">
						<h2 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
							<span className="w-6 h-6 rounded bg-slate-600 text-white flex items-center justify-center text-xs font-bold">
								↓
							</span>
							Method Internals
						</h2>
						<IntermediatesPanel response={state.data} />
					</div>
				</>
			)}
		</div>
	);
}
