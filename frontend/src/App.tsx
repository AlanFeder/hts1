import { useState } from "react";
import CompareView from "./components/CompareView";
import Header from "./components/Header";
import SingleView from "./components/SingleView";

type Tab = "classify" | "compare";

export default function App() {
	const [tab, setTab] = useState<Tab>("classify");

	return (
		<div className="min-h-screen flex flex-col">
			<Header tab={tab} onTabChange={setTab} />
			<main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{tab === "classify" ? <SingleView /> : <CompareView />}
			</main>
			<footer className="border-t border-slate-200 bg-white py-4 px-4 text-xs text-slate-400">
				<div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
					<span>
						HTS Classifier · Powered by Gemini ·{" "}
						<a
							href="https://hts.usitc.gov/"
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2 hover:text-slate-600 transition-colors"
						>
							Data from USITC
						</a>
					</span>
					<span className="flex items-center gap-2">
						<span>Developed by Alan Feder</span>
						<span className="text-slate-300">·</span>
						<span className="text-[10px] text-slate-300">
							Assisted by Claude Code and Antigravity
						</span>
					</span>
				</div>
			</footer>
		</div>
	);
}
