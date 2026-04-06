import type { ClassifyResponse, HTSResult } from "../types";

interface Props {
	response: ClassifyResponse;
	compact?: boolean;
}

export default function ResultsTable({ response, compact = false }: Props) {
	return (
		<div>
			{/* Meta row */}
			{!compact && (
				<div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-slate-500">
					<MetaChip label="Method" value={response.method} mono />
					<MetaChip
						label="Elapsed"
						value={
							response.elapsed_ms != null
								? `${response.elapsed_ms.toFixed(0)} ms`
								: "—"
						}
					/>
					<MetaChip
						label="Cost"
						value={
							response.cost_usd != null
								? `$${response.cost_usd.toFixed(6)}`
								: "—"
						}
					/>
					<MetaChip label="Results" value={String(response.results.length)} />
				</div>
			)}

			{/* Table */}
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-slate-200">
							<th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400 w-6">
								#
							</th>
							<th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
								HTS Code
							</th>
							<th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
								Description
							</th>
							{!compact && (
								<th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400 hidden lg:table-cell">
									Path
								</th>
							)}
							<th className="text-right pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
								Score
							</th>
							{!compact && (
								<th className="text-right pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
									Tariff
								</th>
							)}
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{response.results.map((r, i) => (
							<ResultRow
								key={r.hts_code}
								result={r}
								rank={i + 1}
								compact={compact}
							/>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function ResultRow({
	result,
	rank,
	compact,
}: {
	result: HTSResult;
	rank: number;
	compact: boolean;
}) {
	return (
		<tr className="hover:bg-slate-50 transition-colors group">
			<td className="py-3 pr-4 text-slate-400 font-mono text-xs">{rank}</td>
			<td className="py-3 pr-4">
				{result.hts_code ? (
					<a
						href={`https://hts.usitc.gov/search?query=${result.hts_code}`}
						target="_blank"
						rel="noopener noreferrer"
						className="hts-badge hover:opacity-80 transition-opacity"
					>
						{result.hts_code}
					</a>
				) : (
					<span className="hts-badge">—</span>
				)}
			</td>
			<td className="py-3 pr-4">
				<span className="text-slate-800 font-medium leading-snug">
					{result.description}
				</span>
				{compact && result.path && result.path.length > 0 && (
					<div className="mt-1">
						<Breadcrumb path={result.path} />
					</div>
				)}
			</td>
			{!compact && (
				<td className="py-3 pr-4 hidden lg:table-cell">
					<Breadcrumb path={result.path} />
				</td>
			)}
			<td className="py-3 pr-4">
				<div className="flex items-center gap-2 justify-end">
					<div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
						<div
							className="h-full bg-blue-500 rounded-full"
							style={{ width: `${Math.round(result.score * 100)}%` }}
						/>
					</div>
					<span className="text-xs font-mono text-slate-500 w-10 text-right">
						{result.score.toFixed(3)}
					</span>
				</div>
			</td>
			{!compact && (
				<td className="py-3 text-right">
					{result.general_rate ? (
						<span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
							{result.general_rate}
						</span>
					) : (
						<span className="text-xs text-slate-300">—</span>
					)}
				</td>
			)}
		</tr>
	);
}

function Breadcrumb({ path }: { path: string[] }) {
	const show = path;
	return (
		<div className="flex flex-wrap items-center gap-1">
			{show.map((p, i) => (
				<span key={p} className="flex items-center gap-1">
					{i > 0 && (
						<svg
							aria-hidden="true"
							className="w-3 h-3 text-slate-300 flex-shrink-0"
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
					)}
					<span className="text-xs text-slate-500 leading-tight">{p}</span>
				</span>
			))}
		</div>
	);
}

function MetaChip({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<span className="flex items-center gap-1.5 bg-slate-100 rounded-full px-3 py-1">
			<span className="text-slate-400">{label}:</span>
			<span
				className={`font-semibold text-slate-700 ${mono ? "font-mono" : ""}`}
			>
				{value}
			</span>
		</span>
	);
}
