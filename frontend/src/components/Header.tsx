type Tab = "classify" | "compare";

interface Props {
	tab: Tab;
	onTabChange: (tab: Tab) => void;
}

export default function Header({ tab, onTabChange }: Props) {
	return (
		<header className="bg-navy-800 text-white shadow-md">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				{/* Top bar */}
				<div className="flex items-center justify-between py-4 border-b border-navy-600">
					<div className="flex items-center gap-4">
						{/* Shield icon */}
						<div className="flex-shrink-0 w-10 h-10 rounded-full bg-gold-500 flex items-center justify-center shadow">
							<svg
								aria-hidden="true"
								className="w-5 h-5 text-navy-900"
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path
									fillRule="evenodd"
									d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z"
									clipRule="evenodd"
								/>
							</svg>
						</div>
						<div>
							<div className="text-xs font-semibold tracking-widest uppercase text-gold-400 leading-none mb-0.5">
								U.S. International Trade Commission
							</div>
							<h1 className="text-xl font-bold tracking-tight leading-none">
								HTS Classifier
							</h1>
						</div>
					</div>
					<div className="flex flex-col items-end gap-1">
						<div className="hidden sm:flex items-center gap-2 text-xs text-navy-300">
							<span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
							AI-powered · Harmonized Tariff Schedule
						</div>
						<div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
							<svg
								aria-hidden="true"
								className="w-3 h-3 flex-shrink-0"
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path
									fillRule="evenodd"
									d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
									clipRule="evenodd"
								/>
							</svg>
							<span>Unofficial tool · Not affiliated with USITC</span>
							<a
								href="https://hts.usitc.gov/"
								target="_blank"
								rel="noopener noreferrer"
								className="underline underline-offset-2 hover:text-amber-300 transition-colors"
							>
								Official HTS site
							</a>
						</div>
					</div>
				</div>

				{/* Tab navigation */}
				<nav className="flex gap-1 pt-2 pb-0">
					<TabButton
						active={tab === "classify"}
						onClick={() => onTabChange("classify")}
					>
						<svg
							aria-hidden="true"
							className="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
							/>
						</svg>
						Classify
					</TabButton>
					<TabButton
						active={tab === "compare"}
						onClick={() => onTabChange("compare")}
					>
						<svg
							aria-hidden="true"
							className="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
							/>
						</svg>
						Compare Methods
					</TabButton>
				</nav>
			</div>
		</header>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
				active
					? "bg-slate-50 text-navy-800 border-t border-x border-slate-200"
					: "text-navy-300 hover:text-white hover:bg-navy-700"
			}`}
		>
			{children}
		</button>
	);
}
