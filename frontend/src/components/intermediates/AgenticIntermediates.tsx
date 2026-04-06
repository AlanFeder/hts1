import { useState } from "react";
import type { AgenticBeamStep, AgenticIntermediates } from "../../types";

export default function AgenticIntermediatesPanel({
	data,
}: {
	data: AgenticIntermediates;
}) {
	return (
		<div className="space-y-3">
			<p className="section-label">
				Beam Search Trace ({data.beam_steps.length} steps)
			</p>
			<div className="space-y-2">
				{data.beam_steps.map((step, i) => (
					<BeamStepRow key={step.step} step={step} index={i} />
				))}
			</div>
		</div>
	);
}

function BeamStepRow({
	step,
	index,
}: {
	step: AgenticBeamStep;
	index: number;
}) {
	const [open, setOpen] = useState(index === 0);
	const [showRaw, setShowRaw] = useState(false);

	const isChapter = step.step === "chapter_selection";
	const isFinal = step.step === "final_ranking";
	const isDepth = step.step.startsWith("depth_");

	const stepLabel = isChapter
		? "Chapter Selection"
		: isFinal
			? `Final Ranking (pool: ${step.pool_size ?? "?"})`
			: `Depth ${step.step.replace("depth_", "")} — beam size: ${step.beam_size ?? "?"}`;

	const accentColor = isChapter
		? "border-navy-500 bg-navy-50"
		: isFinal
			? "border-gold-500 bg-amber-50"
			: "border-slate-200 bg-white";

	const dotColor = isChapter
		? "bg-navy-600"
		: isFinal
			? "bg-gold-500"
			: "bg-slate-400";

	return (
		<div className={`rounded-lg border ${accentColor} overflow-hidden`}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="w-full flex items-center gap-3 p-3 text-left hover:bg-black/5 transition-colors"
			>
				<span
					className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`}
				/>
				<span className="text-sm font-semibold text-slate-800 flex-1">
					{stepLabel}
				</span>
				{isChapter && step.selected && (
					<span className="text-xs text-slate-500 font-mono">
						chapters: [{step.selected.join(", ")}]
					</span>
				)}
				{isDepth && (
					<div className="flex gap-3 text-xs text-slate-400 font-mono">
						{(step.explored?.length ?? 0) > 0 && (
							<span className="text-blue-600">
								→{step.explored?.length} explored
							</span>
						)}
						{(step.finalized?.length ?? 0) > 0 && (
							<span className="text-emerald-600">
								✓{step.finalized?.length} finalized
							</span>
						)}
					</div>
				)}
				{isFinal && step.selected && (
					<span className="text-xs text-slate-500">
						{step.selected.length} selected
					</span>
				)}
				<svg
					aria-hidden="true"
					className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M9 5l7 7-7 7"
					/>
				</svg>
			</button>

			{open && (
				<div className="px-4 pb-4 pt-1 space-y-3 border-t border-black/5">
					{/* Chapter selection: show selected codes */}
					{isChapter && step.selected && (
						<div className="flex flex-wrap gap-2">
							{step.selected.map((ch) => (
								<span
									key={ch}
									className="px-3 py-1 rounded-full bg-navy-100 text-navy-700 text-xs font-mono font-semibold"
								>
									Ch. {ch}
								</span>
							))}
						</div>
					)}

					{/* Depth step: explored + finalized */}
					{isDepth && (
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							{(step.explored?.length ?? 0) > 0 && (
								<NodeList
									label="Explored (drill deeper)"
									nodes={step.explored ?? []}
									color="text-blue-700 bg-blue-50 border-blue-200"
									dotColor="bg-blue-400"
								/>
							)}
							{(step.finalized?.length ?? 0) > 0 && (
								<NodeList
									label="Finalized (accepted)"
									nodes={step.finalized ?? []}
									color="text-emerald-700 bg-emerald-50 border-emerald-200"
									dotColor="bg-emerald-400"
								/>
							)}
						</div>
					)}

					{/* Final ranking: selected */}
					{isFinal && step.selected && (
						<NodeList
							label="Final Selected"
							nodes={step.selected}
							color="text-amber-700 bg-amber-50 border-amber-200"
							dotColor="bg-amber-400"
						/>
					)}

					{/* Raw LLM response toggle */}
					<button
						type="button"
						onClick={() => setShowRaw(!showRaw)}
						className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
					>
						<svg
							aria-hidden="true"
							className={`w-3 h-3 transition-transform ${showRaw ? "rotate-90" : ""}`}
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 5l7 7-7 7"
							/>
						</svg>
						Raw LLM Response
					</button>
					{showRaw && (
						<pre className="p-3 bg-slate-900 text-slate-200 text-xs rounded-lg overflow-x-auto font-mono leading-relaxed">
							{step.llm_response}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}

function NodeList({
	label,
	nodes,
	color,
	dotColor,
}: {
	label: string;
	nodes: string[];
	color: string;
	dotColor: string;
}) {
	return (
		<div>
			<p className="text-xs font-semibold text-slate-500 mb-1.5">{label}</p>
			<div className={`rounded-lg border p-2 space-y-1 ${color}`}>
				{nodes.map((n) => (
					<div key={n} className="flex items-start gap-2 text-xs">
						<span
							className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${dotColor}`}
						/>
						<span className="leading-snug">{n}</span>
					</div>
				))}
			</div>
		</div>
	);
}
