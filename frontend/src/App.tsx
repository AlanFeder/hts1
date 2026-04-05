import { useState } from "react";
import Header from "./components/Header";
import SingleView from "./components/SingleView";
import CompareView from "./components/CompareView";

type Tab = "classify" | "compare";

export default function App() {
  const [tab, setTab] = useState<Tab>("classify");

  return (
    <div className="min-h-screen flex flex-col">
      <Header tab={tab} onTabChange={setTab} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {tab === "classify" ? <SingleView /> : <CompareView />}
      </main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
        HTS Classifier · Powered by Gemini · Data from USITC
      </footer>
    </div>
  );
}
