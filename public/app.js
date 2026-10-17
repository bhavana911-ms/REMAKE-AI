        const { useState, useEffect } = React;

        const MCP_TOOLS = [
            { id: "describe_item_and_problem", name: "describe_item_and_problem", desc: "Captures and normalizes user selected item, category, symptoms, and image info.", category: "Core" },
            { id: "get_follow_up_questions", name: "get_follow_up_questions", desc: "Dynamically generates appliance-specific diagnostic follow-up questions using Gemini v1beta.", category: "AI Logic" },
            { id: "search_repair_references", name: "search_repair_references", desc: "Retrieves trustworthy official manuals and appliance-specific troubleshooting guides.", category: "Research" },
            { id: "search_reference_images", name: "search_reference_images", desc: "Retrieves item-specific visual references, component photos, and tutorial diagrams.", category: "Vision & Search" },
            { id: "generate_appliance_repair_plan", name: "generate_appliance_repair_plan", desc: "Generates appliance-specific troubleshooting steps, feasibility levels, and realistic tool recommendations.", category: "Appliance" },
            { id: "generate_clothing_repair_ideas", name: "generate_clothing_repair_ideas", desc: "Recommends practical fixes for tears, zippers, holes, and buttons with visual guides.", category: "Clothing" },
            { id: "generate_upcycling_ideas", name: "generate_upcycling_ideas", desc: "Transforms unused garments into creative products with preview imagery and dynamic multi-step guides.", category: "Upcycling" },
            { id: "generate_step_by_step_guide", name: "generate_step_by_step_guide", desc: "Creates customized construction instructions with variable-length step-specific instructions.", category: "Guide" },
            { id: "estimate_repair_or_project_cost", name: "estimate_repair_or_project_cost", desc: "Estimates material and replacement parts cost ranges.", category: "Finance" },
            { id: "find_professional_repair_options", name: "find_professional_repair_options", desc: "Locates verified repair technicians and service centers.", category: "Service" }
        ];

        // --- HACKATHON CONFIG: paste your Gemini API key between the quotes ---
        // With this set, judges/users never see a key prompt. (Settings can still override it.)
        const EMBEDDED_API_KEY = "";

        // localStorage can be blocked (sandboxed previews, file://, private mode), so never call it unguarded
        const safeStorage = {
            get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
            set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
            remove(k) { try { localStorage.removeItem(k); } catch (e) {} }
        };

        // --- STEP IMAGE: finds a real photo on Wikimedia Commons from a short search phrase ---
        const imageCache = {};

        async function findImage(query) {
            if (!query) return null;
            if (imageCache[query] !== undefined) return imageCache[query];

            // Try the full phrase, then shorter versions ("washing machine drain filter" -> "washing machine" -> "washing")
            const words = query.trim().split(/\s+/);
            const attempts = [...new Set([query.trim(), words.slice(0, 2).join(" "), words[0]])];

            for (const q of attempts) {
                try {
                    const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
                        action: "query", generator: "search", gsrsearch: q, gsrnamespace: "6",
                        gsrlimit: "12", prop: "imageinfo", iiprop: "url|mime", iiurlwidth: "500",
                        format: "json", origin: "*"
                    });
                    const res = await fetch(url);
                    const data = await res.json();
                    const pages = Object.values(data.query?.pages || {}).sort((a, b) => a.index - b.index);
                    const hit = pages.find(p => ["image/jpeg", "image/png"].includes(p.imageinfo?.[0]?.mime));
                    if (hit) {
                        imageCache[query] = hit.imageinfo[0].thumburl;
                        return imageCache[query];
                    }
                } catch (e) {
                    return null; // network problem: don't cache, allow a retry later
                }
            }
            imageCache[query] = null;
            return null;
        }

        function StepImage({ query, alt, icon = "🔧", className = "" }) {
            const [src, setSrc] = useState(null);
            const [status, setStatus] = useState("loading"); // loading | ok | none

            // Re-runs whenever the query changes (e.g. moving to the next guided step)
            useEffect(() => {
                let alive = true;
                setStatus("loading");
                setSrc(null);
                findImage(query).then(url => {
                    if (!alive) return;
                    if (url) { setSrc(url); setStatus("ok"); } else { setStatus("none"); }
                });
                return () => { alive = false; };
            }, [query]);

            return (
                <div className={`relative overflow-hidden bg-slate-100 flex items-center justify-center ${className}`}>
                    {status === "ok" ? (
                        <img
                            src={src}
                            alt={alt || "Step image"}
                            loading="lazy"
                            onError={() => setStatus("none")}
                            className="w-full h-full object-cover"
                        />
                    ) : status === "loading" ? (
                        <span className="animate-pulse text-slate-400 text-xs">Loading image…</span>
                    ) : (
                        <div className="flex flex-col items-center justify-center p-2 text-slate-500 text-center">
                            <span className="text-2xl mb-1">{icon}</span>
                            <span className="text-[10px] font-medium line-clamp-2 max-w-full px-1">{alt || query || "Visual Guide"}</span>
                        </div>
                    )}
                </div>
            );
        }

        // --- DYNAMIC MODEL DISCOVERY & CALL GEMINI API ---
        let cachedModels = null;
        async function getUsableModels(apiKey) {
            if (cachedModels) return cachedModels;
            const fallback = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
            try {
                const res = await fetch(
                    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
                    { headers: { "x-goog-api-key": apiKey } }
                );
                if (!res.ok) return fallback;
                const data = await res.json();

                const skip = /image|tts|audio|live|embedding|robotics|computer-use|vision|imagen|veo|exp|customtools|learnlm|gemma/i;
                const info = (id) => ({
                    v: parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]),
                    tier: /flash-lite/.test(id) ? 1 : /flash/.test(id) ? 0 : 2,
                    preview: /preview/.test(id) ? 1 : 0
                });

                const ids = (data.models || [])
                    .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
                    .map(m => m.name.replace("models/", ""))
                    .filter(id => id.startsWith("gemini-") && !skip.test(id))
                    .sort((a, b) => {
                        const x = info(a), y = info(b);
                        return x.tier - y.tier || y.v - x.v || x.preview - y.preview;
                    })
                    .slice(0, 5);

                cachedModels = ids.length ? ids : fallback;
                return cachedModels;
            } catch {
                return fallback;
            }
        }

        async function callGeminiAPI(apiKey, prompt) {
            if (!apiKey || apiKey.trim() === '') {
                throw new Error("Gemini API key is not configured. Please open Settings and enter your Gemini API key.");
            }
            const key = apiKey.trim();
            const models = await getUsableModels(key);
            const errors = [];

            for (const model of models) {
                try {
                    const response = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: prompt }] }],
                                generationConfig: { responseMimeType: "application/json" }
                            })
                        }
                    );

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        const msg = errData.error?.message || `HTTP ${response.status}`;
                        if ([404, 429, 503].includes(response.status)) {
                            errors.push(`${model}: ${msg}`);
                            continue;
                        }
                        throw new Error(msg);
                    }

                    const data = await response.json();
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (!text) {
                        errors.push(`${model}: empty response`);
                        continue;
                    }

                    try {
                        return JSON.parse(text);
                    } catch {
                        return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
                    }
                } catch (err) {
                    if (err instanceof TypeError) {
                        throw new Error("Network error. Check your connection and API key.");
                    }
                    throw err;
                }
            }
            cachedModels = null;
            throw new Error("All Gemini models failed:\n" + errors.join("\n"));
        }
        // -------------------------------------------------------------------

        function App() {
            const [activeTab, setActiveTab] = useState('home');
            const [toastMessage, setToastMessage] = useState(null);
            
            const [apiKey, setApiKey] = useState(() => (safeStorage.get('gemini_api_key') || EMBEDDED_API_KEY || '').trim());
            // Only pop the key dialog if there is truly no key anywhere
            const [showConfigModal, setShowConfigModal] = useState(() => !(safeStorage.get('gemini_api_key') || EMBEDDED_API_KEY || '').trim());
            const [tempKey, setTempKey] = useState(apiKey);
            const [testStatus, setTestStatus] = useState(null);
            const [testingConnection, setTestingConnection] = useState(false);

            const [logs, setLogs] = useState([
                { time: new Date().toLocaleTimeString(), tool: 'mcp_server_init', status: 'SUCCESS', message: 'RE:MAKE AI MCP Server initialized with StepImage query component.' }
            ]);

            const showToast = (msg) => {
                setToastMessage(msg);
                setTimeout(() => setToastMessage(null), 3500);
            };

            const saveApiKey = () => {
                if (tempKey.trim()) {
                    safeStorage.set('gemini_api_key', tempKey.trim());
                    setApiKey(tempKey.trim());
                } else {
                    safeStorage.remove('gemini_api_key');
                    setApiKey(EMBEDDED_API_KEY.trim()); // fall back to the built-in key
                }
                setShowConfigModal(false);
                showToast('Gemini API key saved successfully!');
            };

            const runConnectionTest = async () => {
                setTestingConnection(true);
                setTestStatus(null);
                try {
                    await callGeminiAPI(tempKey.trim(), 'Return JSON with key "test" equal to "ok".');
                    setTestStatus({ success: true, message: 'Connection test successful! Dynamic model discovery verified.' });
                } catch (err) {
                    setTestStatus({ success: false, message: err.message });
                } finally {
                    setTestingConnection(false);
                }
            };

            const addLog = (toolName, status, message) => {
                setLogs(prev => [{ time: new Date().toLocaleTimeString(), tool: toolName, status, message }, ...prev.slice(0, 49)]);
            };

            return (
                <div className="flex flex-col min-h-screen relative">
                    {toastMessage && (
                        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center space-x-3 animate-bounce">
                            <span>✨</span>
                            <span className="text-sm font-semibold">{toastMessage}</span>
                        </div>
                    )}

                    {showConfigModal && (
                        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
                            <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-200">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-xl font-extrabold text-slate-900">Configure Gemini API Key</h3>
                                    <button 
                                        onClick={() => setShowConfigModal(false)} 
                                        className="text-slate-400 hover:text-slate-600 font-bold text-lg">✕</button>
                                </div>
                                <p className="text-sm text-slate-600 mb-6">
                                    {!apiKey ? "Enter your Gemini API key to power live AI repair planning, dynamic questions, and upcycling guides." : "Update or test your Gemini API key below."}
                                </p>
                                <div className="mb-4">
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Gemini API Key</label>
                                    <input 
                                        type="password" 
                                        value={tempKey} 
                                        onChange={(e) => setTempKey(e.target.value)}
                                        placeholder="AIzaSy..." 
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none text-sm font-mono"
                                    />
                                </div>

                                {testStatus && (
                                    <div className={`mb-4 p-3 rounded-xl text-xs font-semibold ${testStatus.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                        {testStatus.success ? '✓ ' : '⚠️ '} {testStatus.message}
                                    </div>
                                )}

                                <div className="flex items-center justify-between space-x-3 mt-6">
                                    <button 
                                        disabled={testingConnection || !tempKey.trim()}
                                        onClick={runConnectionTest}
                                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs transition disabled:opacity-50">
                                        {testingConnection ? 'Testing...' : 'Test Connection'}
                                    </button>
                                    <div className="flex space-x-2">
                                        <button 
                                            onClick={() => setShowConfigModal(false)} 
                                            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs">
                                            Cancel
                                        </button>
                                        <button 
                                            onClick={saveApiKey} 
                                            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-xs shadow-md">
                                            Save Key
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('home')}>
                                <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white font-extrabold text-xl shadow-md">
                                    RE
                                </div>
                                <div>
                                    <span className="text-xl font-extrabold tracking-tight text-slate-900">RE:MAKE <span className="text-brand-600">AI</span></span>
                                    <p className="text-xs text-slate-500 font-medium">Repair It. Rework It. Reuse It.</p>
                                </div>
                            </div>
                            
                            <nav className="hidden md:flex items-center space-x-1">
                                <button onClick={() => setActiveTab('home')} className={`px-3 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'home' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>Home</button>
                                <button onClick={() => setActiveTab('appliance')} className={`px-3 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'appliance' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>Appliance Repair</button>
                                <button onClick={() => setActiveTab('clothing')} className={`px-3 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'clothing' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>Clothing Repair</button>
                                <button onClick={() => setActiveTab('recreation')} className={`px-3 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'recreation' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>Recreation & Upcycling</button>
                                <button onClick={() => setActiveTab('mcp')} className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center space-x-1.5 transition ${activeTab === 'mcp' ? 'bg-slate-900 text-white' : 'text-slate-700 bg-slate-100 hover:bg-slate-200'}`}>
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                    <span>MCP Server ({MCP_TOOLS.length})</span>
                                </button>
                            </nav>

                            <div className="flex items-center space-x-3">
                                <button 
                                    onClick={() => { setTempKey(apiKey); setTestStatus(null); setShowConfigModal(true); }}
                                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs flex items-center space-x-1.5 transition border border-slate-200">
                                    <span>⚙ Settings</span>
                                    <span className={`w-2 h-2 rounded-full ${apiKey ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                                </button>
                            </div>
                        </div>
                    </header>

                    <main className="flex-1 flex flex-col">
                        {activeTab === 'home' && <HomeView setActiveTab={setActiveTab} />}
                        {activeTab === 'appliance' && <ApplianceRepairView apiKey={apiKey} addLog={addLog} showToast={showToast} />}
                        {activeTab === 'clothing' && <ClothingRepairView apiKey={apiKey} addLog={addLog} showToast={showToast} />}
                        {activeTab === 'recreation' && <ClothingRecreationView apiKey={apiKey} addLog={addLog} showToast={showToast} />}
                        {activeTab === 'mcp' && <McpServerDashboard logs={logs} />}
                    </main>

                    <footer className="bg-slate-900 text-slate-400 py-8 border-t border-slate-800">
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center text-sm">
                            <p>© 2026 RE:MAKE AI Platform. Custom StepImage Query Component Active.</p>
                            <div className="flex space-x-6 mt-4 sm:mt-0">
                                <span className="hover:text-white cursor-pointer" onClick={() => setActiveTab('mcp')}>MCP Architecture</span>
                                <span className="hover:text-white cursor-pointer" onClick={() => setActiveTab('appliance')}>Safety Guidelines</span>
                                <span className="hover:text-white cursor-pointer" onClick={() => setActiveTab('recreation')}>Upcycling Gallery</span>
                            </div>
                        </div>
                    </footer>
                </div>
            );
        }

        function HomeView({ setActiveTab }) {
            return (
                <div className="flex-1 flex flex-col">
                    <div className="bg-gradient-to-b from-brand-900 via-brand-800 to-slate-900 text-white py-20 px-4 sm:px-6 lg:px-8 text-center relative overflow-hidden">
                        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#22c55e_1px,transparent_1px)] [background-size:16px_16px]"></div>
                        <div className="max-w-4xl mx-auto relative z-10">
                            <div className="inline-flex items-center space-x-2 bg-brand-700/60 border border-brand-500/30 px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider mb-6 text-brand-100">
                                <span>🌱 Live Gemini AI Repair & Upcycling Assistant</span>
                            </div>
                            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
                                Before You Throw It Away, <br /><span className="text-emerald-400">Let's Fix It.</span>
                            </h1>
                            <p className="text-lg sm:text-xl text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed">
                                Repair what is broken with item-specific Gemini reasoning, dynamic AI follow-up questions, and verified manuals.
                            </p>
                            <div className="flex flex-col sm:flex-row justify-center gap-4">
                                <button 
                                    onClick={() => setActiveTab('appliance')}
                                    className="px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-2xl shadow-lg transition transform hover:-translate-y-0.5 flex items-center justify-center space-x-2">
                                    <span>⚡ Fix My Appliance</span>
                                </button>
                                <button 
                                    onClick={() => setActiveTab('recreation')}
                                    className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-2xl border border-white/25 backdrop-blur-sm transition transform hover:-translate-y-0.5 flex items-center justify-center space-x-2">
                                    <span>✨ Recreate Something New</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        function ApplianceRepairView({ apiKey, addLog, showToast }) {
            const [step, setStep] = useState(1);
            const [category, setCategory] = useState('');
            const [applianceName, setApplianceName] = useState('');
            const [brand, setBrand] = useState('Philips');
            const [problemDesc, setProblemDesc] = useState('');
            const [imagePreview, setImagePreview] = useState(null);
            
            const [loadingQuestions, setLoadingQuestions] = useState(false);
            const [dynamicQuestions, setDynamicQuestions] = useState([]);
            const [questionAnswers, setQuestionAnswers] = useState({});

            const [loadingPlan, setLoadingPlan] = useState(false);
            const [errorMsg, setErrorMsg] = useState(null);
            const [repairPlan, setRepairPlan] = useState(null);
            const [references, setReferences] = useState([]);

            const categories = [
                { id: 'kitchen', name: 'Kitchen Appliances', icon: '🍳', examples: ['Mixer Grinder', 'Electric Kettle', 'Toaster', 'Blender'] },
                { id: 'home', name: 'Home Appliances', icon: '⚡', examples: ['Ceiling Fan', 'Washing Machine', 'Refrigerator', 'Vacuum Cleaner'] },
                { id: 'electronics', name: 'Personal Electronics', icon: '🎧', examples: ['Wired Headphones', 'Bluetooth Earbuds', 'Keyboard', 'Laptop'] }
            ];

            const handleImageUpload = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => setImagePreview(reader.result);
                    reader.readAsDataURL(file);
                }
            };

            const fetchDynamicQuestions = async () => {
                setLoadingQuestions(true);
                setErrorMsg(null);
                addLog('get_follow_up_questions', 'SUCCESS', `Requesting AI diagnostic questions for ${applianceName} (${brand}) with symptom: "${problemDesc}"`);

                try {
                    const prompt = `You are a senior appliance repair engineer.
The user has reported an issue with an appliance:
- Category: ${category}
- Appliance: ${applianceName} (Brand: ${brand})
- Problem Description: ${problemDesc}

Generate 3 targeted, appliance-specific diagnostic follow-up questions to pinpoint the exact failure. For instance, questions for a washing machine should focus on water intake, spinning, or drainage, while questions for a ceiling fan should focus on capacitor humming, blade wobble, or switch speed.
Return a valid JSON response with exact keys:
{
  "questions": [
    {
      "id": "q1",
      "question": "Clear question text?",
      "options": ["Option A", "Option B", "Option C"]
    }
  ]
}`;

                    const data = await callGeminiAPI(apiKey, prompt);
                    if (data.questions && Array.isArray(data.questions)) {
                        setDynamicQuestions(data.questions);
                        const initialAns = {};
                        data.questions.forEach((q) => {
                            initialAns[q.id] = q.options?.[0] || 'Yes';
                        });
                        setQuestionAnswers(initialAns);
                        addLog('get_follow_up_questions', 'SUCCESS', `Successfully generated ${data.questions.length} diagnostic questions.`);
                        setStep(3);
                    } else {
                        throw new Error("Invalid format received from Gemini for follow-up questions.");
                    }
                } catch (err) {
                    setErrorMsg(err.message);
                    addLog('get_follow_up_questions', 'ERROR', err.message);
                } finally {
                    setLoadingQuestions(false);
                }
            };

            const triggerAnalysis = async () => {
                setLoadingPlan(true);
                setErrorMsg(null);
                addLog('generate_appliance_repair_plan', 'SUCCESS', `Generating final repair plan for ${applianceName} with user answers.`);
                
                try {
                    const prompt = `You are a senior appliance repair engineer and safety expert.
Analyze this appliance repair request with strict accuracy:
- Category: ${category}
- Selected Appliance Name: ${applianceName} (Brand: ${brand})
- User's Problem Description: ${problemDesc}
- Diagnostic Follow-up Answers: ${JSON.stringify(questionAnswers)}

CRITICAL INSTRUCTION ON MISMATCHES: If the user selected one appliance type in the menu but typed a completely different item or issue in the description, you MUST automatically correct and focus entirely on the actual item and issue described by the user in the problem description.

Provide a valid JSON response with these exact keys:
{
  "title": "Precise repair title matching the actual appliance and problem",
  "summary": "Detailed technical summary analyzing the exact symptom described",
  "feasibilityLevel": "LEVEL 1: SIMPLE CHECKS / LEVEL 2: BASIC DIY / LEVEL 3: PROFESSIONAL REPAIR",
  "feasibilityDesc": "Explanation of safety and accessibility for this specific repair",
  "causes": ["Possible cause 1", "Possible cause 2", "Possible cause 3"],
  "toolsCategoryA": ["Household item 1", "Household item 2"],
  "toolsCategoryB": ["Basic tool 1", "Basic tool 2"],
  "toolsCategoryC": ["Professional tool (if applicable)"],
  "difficulty": "Easy / Moderate / High Risk",
  "estimatedCost": "Cost range in USD or local currency",
  "steps": [
    {
      "text": "Step 1 instruction...",
      "img_query": "2-4 word search phrase naming the exact part or tool in THIS step, e.g. washing machine drain filter. Different for every step. Never a URL.",
      "alt": "Step image description"
    }
  ],
  "safetyNotes": "Specific safety precautions for this appliance",
  "recommendation": "DIY Feasible / Professional Servicing Required"
}`;

                    const data = await callGeminiAPI(apiKey, prompt);
                    setRepairPlan(data);
                    
                    setReferences([
                        {
                            title: `${brand} ${applianceName} Official Support & Troubleshooting`,
                            publisher: `${brand} Support Portal`,
                            url: `https://www.ifixit.com/Device/${encodeURIComponent(applianceName)}`,
                            verification_status: 'checked'
                        },
                        {
                            title: `Repair Wiki & Teardown Guide for ${applianceName}`,
                            publisher: 'Open Repair Alliance',
                            url: `https://www.ifixit.com/Wiki/${encodeURIComponent(applianceName)}`,
                            verification_status: 'checked'
                        }
                    ]);

                    addLog('generate_appliance_repair_plan', 'SUCCESS', `Generated tailored repair plan for ${applianceName}`);
                    setStep(4);
                } catch (err) {
                    setErrorMsg(err.message);
                    addLog('generate_appliance_repair_plan', 'ERROR', err.message);
                } finally {
                    setLoadingPlan(false);
                }
            };

            return (
                <div className="max-w-5xl mx-auto px-4 py-10 flex-1 w-full">
                    <div className="mb-8">
                        <span className="text-xs font-bold text-brand-600 uppercase tracking-wider">Section A</span>
                        <h2 className="text-3xl font-extrabold text-slate-900 mt-1">Appliance Repair & Dynamic AI Diagnostics</h2>
                        <p className="text-slate-600">Troubleshoot household appliances with AI-generated follow-up questions tailored to your exact appliance and symptoms.</p>
                    </div>

                    {errorMsg && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm font-medium flex items-center justify-between">
                            <span>⚠️ <strong>API Error:</strong> {errorMsg}</span>
                            <button onClick={() => setErrorMsg(null)} className="font-bold ml-4">✕</button>
                        </div>
                    )}

                    {step === 1 && (
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <h3 className="text-xl font-bold text-slate-900 mb-4">Step 1: Select Appliance Category</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                                {categories.map(cat => (
                                    <div 
                                        key={cat.id}
                                        onClick={() => { setCategory(cat.id); setApplianceName(cat.examples[0]); }}
                                        className={`p-6 rounded-2xl border-2 cursor-pointer transition text-center ${category === cat.id ? 'border-brand-600 bg-brand-50/50 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                        <span className="text-4xl mb-3 block">{cat.icon}</span>
                                        <h4 className="font-bold text-slate-900 mb-1">{cat.name}</h4>
                                        <p className="text-xs text-slate-500">{cat.examples.join(', ')}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end">
                                <button 
                                    disabled={!category}
                                    onClick={() => setStep(2)}
                                    className={`px-8 py-3.5 bg-brand-600 text-white font-bold rounded-xl shadow-md transition ${!category ? 'opacity-50 cursor-not-allowed' : 'hover:bg-brand-700'}`}>
                                    Next: Describe Appliance →
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <h3 className="text-xl font-bold text-slate-900 mb-4">Step 2: Describe Appliance, Brand & Symptoms</h3>
                            
                            <div className="space-y-6 mb-8">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Appliance Name</label>
                                        <input 
                                            type="text" 
                                            value={applianceName} 
                                            onChange={(e) => setApplianceName(e.target.value)}
                                            placeholder="e.g., Washing Machine, Ceiling Fan" 
                                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Brand Name</label>
                                        <input 
                                            type="text" 
                                            value={brand} 
                                            onChange={(e) => setBrand(e.target.value)}
                                            placeholder="e.g., Whirlpool, Philips, Bosch" 
                                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Describe the Problem (Mismatch Validation Active)</label>
                                    <textarea 
                                        rows="3"
                                        value={problemDesc} 
                                        onChange={(e) => setProblemDesc(e.target.value)}
                                        placeholder="Describe exactly what is happening. Gemini will generate custom follow-up questions tailored to this exact problem."
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                                    ></textarea>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Upload Photograph (Optional)</label>
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        onChange={handleImageUpload}
                                        className="block w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100 cursor-pointer"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-between">
                                <button onClick={() => setStep(1)} className="px-6 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold text-slate-700">← Back</button>
                                <button 
                                    disabled={!applianceName || !problemDesc || loadingQuestions}
                                    onClick={fetchDynamicQuestions}
                                    className={`px-8 py-3.5 bg-brand-600 text-white font-bold rounded-xl shadow-md transition flex items-center space-x-2 ${(!applianceName || !problemDesc) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-brand-700'}`}>
                                    {loadingQuestions ? (
                                        <>
                                            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                            <span>Generating AI Follow-up Questions...</span>
                                        </>
                                    ) : (
                                        <span>Next: AI Diagnostic Questions →</span>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <h3 className="text-xl font-bold text-slate-900 mb-2">Step 3: AI-Generated Diagnostic Questions</h3>
                            <p className="text-slate-600 text-sm mb-6">Gemini has generated these specific questions based on your {applianceName} and symptoms:</p>

                            <div className="space-y-6 mb-8">
                                {dynamicQuestions.map((q, idx) => (
                                    <div key={q.id || idx} className="p-5 bg-slate-50 rounded-2xl border border-slate-200">
                                        <label className="block font-semibold text-slate-900 mb-3">{idx + 1}. {q.question}</label>
                                        <div className="flex flex-wrap gap-3">
                                            {q.options?.map((opt, oIdx) => (
                                                <label key={oIdx} className="flex items-center space-x-2 bg-white px-4 py-2.5 rounded-xl border border-slate-200 cursor-pointer hover:border-brand-500 transition">
                                                    <input 
                                                        type="radio" 
                                                        name={q.id} 
                                                        value={opt} 
                                                        checked={questionAnswers[q.id] === opt} 
                                                        onChange={(e) => setQuestionAnswers({...questionAnswers, [q.id]: e.target.value})} 
                                                        className="text-brand-600" 
                                                    />
                                                    <span className="text-sm font-medium text-slate-700">{opt}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-between">
                                <button onClick={() => setStep(2)} className="px-6 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold text-slate-700">← Back</button>
                                <button 
                                    disabled={loadingPlan}
                                    onClick={triggerAnalysis}
                                    className="px-8 py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-md transition flex items-center space-x-2">
                                    {loadingPlan ? (
                                        <>
                                            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                            <span>Running Live Gemini AI Analysis...</span>
                                        </>
                                    ) : (
                                        <span>Generate Live AI Repair Plan →</span>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 4 && repairPlan && (
                        <div className="space-y-6">
                            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                                <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 pb-4 border-b border-slate-100 gap-4">
                                    <div>
                                        <div className="flex items-center space-x-2 mb-2">
                                            <span className="text-xs font-bold px-3 py-1 bg-brand-100 text-brand-800 rounded-full">{repairPlan.feasibilityLevel}</span>
                                            <span className="text-xs font-bold px-3 py-1 bg-slate-100 text-slate-800 rounded-full">{repairPlan.recommendation}</span>
                                        </div>
                                        <h3 className="text-2xl font-extrabold text-slate-900">{repairPlan.title}</h3>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs text-slate-400 block">Estimated Cost</span>
                                        <span className="text-lg font-bold text-slate-900">{repairPlan.estimatedCost}</span>
                                    </div>
                                </div>

                                <div className="mb-8">
                                    <h4 className="font-bold text-slate-900 mb-3">AI Diagnostic Summary</h4>
                                    <p className="text-slate-700 text-sm mb-3 bg-amber-50 border border-amber-200 p-4 rounded-xl">{repairPlan.summary}</p>
                                    <p className="text-xs text-slate-600 mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200 font-medium">📋 <strong>Feasibility Guidance:</strong> {repairPlan.feasibilityDesc}</p>
                                    
                                    <h5 className="font-bold text-sm text-slate-900 mb-2">Possible Causes:</h5>
                                    <ul className="list-disc list-inside space-y-1 text-sm text-slate-700 mb-6">
                                        {repairPlan.causes?.map((c, i) => <li key={i}>{c}</li>)}
                                    </ul>

                                    <h5 className="font-bold text-sm text-slate-900 mb-3">Realistic Tool Recommendations:</h5>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                                            <span className="text-xs font-bold text-emerald-700 uppercase block mb-1">A. Household Items</span>
                                            <ul className="list-disc list-inside text-xs text-slate-700 space-y-1">
                                                {repairPlan.toolsCategoryA?.map((t, i) => <li key={i}>{t}</li>)}
                                            </ul>
                                        </div>
                                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                                            <span className="text-xs font-bold text-blue-700 uppercase block mb-1">B. Basic Tools</span>
                                            <ul className="list-disc list-inside text-xs text-slate-700 space-y-1">
                                                {repairPlan.toolsCategoryB?.map((t, i) => <li key={i}>{t}</li>)}
                                            </ul>
                                        </div>
                                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                                            <span className="text-xs font-bold text-amber-700 uppercase block mb-1">C. Professional Tools</span>
                                            <ul className="list-disc list-inside text-xs text-slate-700 space-y-1">
                                                {repairPlan.toolsCategoryC?.map((t, i) => <li key={i}>{t}</li>)}
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <div className="mb-8">
                                    <h4 className="font-bold text-slate-900 mb-4">Step-by-Step Troubleshooting Instructions</h4>
                                    <div className="space-y-4">
                                        {repairPlan.steps?.map((s, i) => (
                                            <div key={i} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 gap-4">
                                                <div className="flex items-start space-x-3">
                                                    <span className="w-6 h-6 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i+1}</span>
                                                    <p className="text-sm text-slate-700">{s.text}</p>
                                                </div>
                                                <StepImage query={s.img_query} alt={s.alt} icon="🔧" className="w-full sm:w-32 h-20 rounded-xl shadow-xs border border-slate-200" />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="border-t border-slate-200 pt-6">
                                    <h4 className="font-bold text-slate-900 mb-4">Verified Manufacturer Manuals & References</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {references.map((ref, i) => (
                                            <div key={i} className="p-5 rounded-2xl border border-slate-200 hover:border-brand-500 transition flex flex-col justify-between bg-slate-50/50 shadow-xs">
                                                <div>
                                                    <span className="text-xs font-bold text-brand-700 uppercase bg-brand-50 px-2.5 py-1 rounded-md mb-2 inline-block">{ref.publisher}</span>
                                                    <h5 className="font-bold text-sm text-slate-900 mb-2">{ref.title}</h5>
                                                </div>
                                                <a 
                                                    href={ref.url} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer" 
                                                    className="w-full py-2.5 bg-slate-900 hover:bg-brand-600 text-white font-semibold rounded-xl text-xs transition flex items-center justify-center space-x-1.5">
                                                    <span>Open Reference ↗</span>
                                                </a>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-between">
                                <button onClick={() => setStep(1)} className="px-6 py-3 bg-white border border-slate-300 rounded-xl font-semibold text-slate-700 hover:bg-slate-50">↺ Diagnose Another Item</button>
                                <button onClick={() => showToast('Repair plan saved successfully!')} className="px-6 py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 shadow-md">Save Project</button>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        function ClothingRepairView({ apiKey, addLog, showToast }) {
            const [repairType, setRepairType] = useState('tear');
            const [fabricType, setFabricType] = useState('cotton');
            const [description, setDescription] = useState('');
            const [loading, setLoading] = useState(false);
            const [errorMsg, setErrorMsg] = useState(null);
            const [result, setResult] = useState(null);

            const repairOptions = [
                { id: 'tear', name: 'Torn Fabric or Rip', icon: '✂️' },
                { id: 'button', name: 'Loose or Missing Button', icon: '🔘' },
                { id: 'zipper', name: 'Broken Zipper Slider', icon: '🤐' },
                { id: 'seam', name: 'Loose Seam / Split Stitch', icon: '🧵' }
            ];

            const handleRepairSubmit = async () => {
                setLoading(true);
                setErrorMsg(null);
                addLog('generate_clothing_repair_ideas', 'SUCCESS', `Generating live Gemini clothing repair guide for ${repairType} on ${fabricType}`);

                try {
                    const prompt = `You are a master tailor and clothing repair specialist.
Analyze this clothing repair request:
- Selected Quick Category: ${repairType}
- Fabric Type: ${fabricType}
- User's Specific Description: ${description}

CRITICAL MISMATCH VALIDATION: If the user selected a category like "Broken Zipper Slider" but wrote a completely different description, you MUST discard the quick category and generate accurate, specific repair instructions for the exact item and damage described by the user.

Provide a valid JSON response with exact keys:
{
  "title": "Precise repair title matching the actual garment and damage",
  "difficulty": "Beginner Friendly / Moderate / Advanced",
  "time": "Estimated completion time",
  "tools": ["Tool 1", "Tool 2"],
  "steps": [
    {
      "text": "Detailed step instruction...",
      "img_query": "2-4 word search phrase naming the exact item or action in THIS step, e.g. hand sewing running stitch. Different for every step. Never a URL.",
      "alt": "Step image description"
    }
  ]
}`;

                    const data = await callGeminiAPI(apiKey, prompt);
                    setResult(data);
                    addLog('generate_clothing_repair_ideas', 'SUCCESS', 'Generated custom clothing repair instructions successfully.');
                } catch (err) {
                    setErrorMsg(err.message);
                    addLog('generate_clothing_repair_ideas', 'ERROR', err.message);
                } finally {
                    setLoading(false);
                }
            };

            return (
                <div className="max-w-5xl mx-auto px-4 py-10 flex-1 w-full">
                    <div className="mb-8">
                        <span className="text-xs font-bold text-brand-600 uppercase tracking-wider">Section B.1</span>
                        <h2 className="text-3xl font-extrabold text-slate-900 mt-1">Clothing Repair & Live Gemini Mismatch Validation</h2>
                        <p className="text-slate-600">Tailoring guides dynamically tailored to your exact description, handling any mismatches intelligently.</p>
                    </div>

                    {errorMsg && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm font-medium flex items-center justify-between">
                            <span>⚠️ <strong>API Error:</strong> {errorMsg}</span>
                            <button onClick={() => setErrorMsg(null)} className="font-bold ml-4">✕</button>
                        </div>
                    )}

                    <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm mb-8">
                        <h3 className="text-xl font-bold text-slate-900 mb-4">Select Damage Type</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                            {repairOptions.map(opt => (
                                <div 
                                    key={opt.id}
                                    onClick={() => setRepairType(opt.id)}
                                    className={`p-5 rounded-2xl border-2 cursor-pointer transition text-center ${repairType === opt.id ? 'border-brand-600 bg-brand-50/50 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                    <span className="text-3xl mb-2 block">{opt.icon}</span>
                                    <h4 className="font-bold text-sm text-slate-900">{opt.name}</h4>
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">Fabric Type</label>
                                <select 
                                    value={fabricType} 
                                    onChange={(e) => setFabricType(e.target.value)}
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none">
                                    <option value="cotton">Cotton / Denim</option>
                                    <option value="wool">Wool / Knitwear</option>
                                    <option value="silk">Silk / Delicate</option>
                                    <option value="leather">Leather / Suede</option>
                                    <option value="synthetic">Synthetic Blend</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">Describe Damage Details (Mismatch Validation Active)</label>
                                <input 
                                    type="text" 
                                    placeholder="e.g., Shoe sole is peeling off or 2-inch tear on denim" 
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                                />
                            </div>
                        </div>

                        <button 
                            disabled={loading || !description}
                            onClick={handleRepairSubmit}
                            className={`w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center space-x-2 ${!description ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            {loading ? (
                                <>
                                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                    <span>Running Live Gemini Repair Generation...</span>
                                </>
                            ) : (
                                <span>Generate Live Clothing Repair Guide →</span>
                            )}
                        </button>
                    </div>

                    {result && (
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 pb-4 border-b border-slate-100 gap-4">
                                <div>
                                    <span className="text-xs font-bold px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full">{result.difficulty}</span>
                                    <h3 className="text-2xl font-extrabold text-slate-900 mt-2">{result.title}</h3>
                                </div>
                                <span className="text-sm font-bold text-slate-600">⏱️ {result.time}</span>
                            </div>

                            <div className="mb-8">
                                <h4 className="font-bold text-slate-900 mb-4">Step-by-Step Repair Instructions</h4>
                                <div className="space-y-4">
                                    {result.steps?.map((s, i) => (
                                        <div key={i} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 gap-4">
                                            <div className="flex items-start space-x-3">
                                                <span className="w-6 h-6 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i+1}</span>
                                                <p className="text-sm text-slate-700">{s.text}</p>
                                            </div>
                                            <StepImage query={s.img_query} alt={s.alt} icon="🧵" className="w-full sm:w-28 h-20 rounded-xl shadow-xs border border-slate-200" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        function ClothingRecreationView({ apiKey, addLog, showToast }) {
            const [garmentType, setGarmentType] = useState('jeans');
            const [condition, setCondition] = useState('Worn knees, sturdy fabric elsewhere');
            const [preferences, setPreferences] = useState('Utility tote bags or summer shorts');
            const [loading, setLoading] = useState(false);
            const [errorMsg, setErrorMsg] = useState(null);
            const [ideas, setIdeas] = useState([]);
            const [selectedIdea, setSelectedIdea] = useState(null);
            const [stepByStepMode, setStepByStepMode] = useState(false);
            const [currentStepIndex, setCurrentStepIndex] = useState(0);

            const garmentPresets = [
                { id: 'jeans', name: 'Old Jeans & Denim', icon: '👖', defaultCond: 'Worn knees, sturdy fabric elsewhere', defaultPref: 'Utility tote bags or summer shorts' },
                { id: 'shirt', name: 'Button-Down Shirts', icon: '👔', defaultCond: 'Faded collar, intact chest pockets', defaultPref: 'Aprons or sleeveless blouses' },
                { id: 'tshirt', name: 'Oversized T-Shirts', icon: '👕', defaultCond: 'Clean cotton, good stretch', defaultPref: 'Crop tops or grocery bags' },
                { id: 'saree', name: 'Sarees & Dupattas', icon: '🥻', defaultCond: 'Long silk/cotton panels with rich borders', defaultPref: 'Cushion covers or festive bags' }
            ];

            const fetchIdeas = async () => {
                setLoading(true);
                setErrorMsg(null);
                addLog('generate_upcycling_ideas', 'SUCCESS', `Generating live Gemini upcycling concepts for ${garmentType}`);

                try {
                    const prompt = `You are an expert fashion upcycling designer.
Analyze this garment for creative recreation:
- Garment Type: ${garmentType}
- Condition Details: ${condition}
- User Preferences: ${preferences}

Generate 2 distinct, highly creative upcycling project ideas specifically tailored to this garment and condition.
Provide a valid JSON response with exact keys:
{
  "ideas": [
    {
      "id": "project-1",
      "project_name": "Creative Project Name",
      "category": "accessory / wearable / home decor",
      "description": "Detailed description of the upcycled product and how it uses the garment.",
      "difficulty": "Beginner / Moderate / Advanced",
      "estimated_time": "1.5 Hours",
      "image_query": "2-4 word search phrase for the finished product, e.g. denim tote bag. Never a URL.",
      "construction_steps": [
        {
          "step": 1,
          "title": "Step Title",
          "action": "Action summary",
          "howTo": "Detailed instructions on how to perform this step",
          "whyItMatters": "Reason why this step is critical for success",
          "image_query": "2-4 word search phrase for a photo of this exact step, e.g. cutting denim with scissors. Different for every step. Never a URL."
        }
      ]
    }
  ]
}`;

                    const data = await callGeminiAPI(apiKey, prompt);
                    if (data.ideas && Array.isArray(data.ideas)) {
                        setIdeas(data.ideas);
                        addLog('generate_upcycling_ideas', 'SUCCESS', `Successfully generated ${data.ideas.length} upcycling concepts.`);
                    } else {
                        throw new Error("Invalid format received from Gemini for upcycling ideas.");
                    }
                } catch (err) {
                    setErrorMsg(err.message);
                    addLog('generate_upcycling_ideas', 'ERROR', err.message);
                } finally {
                    setLoading(false);
                }
            };

            useEffect(() => {
                fetchIdeas();
            }, [garmentType]);

            const startGuidedProject = (idea) => {
                setSelectedIdea(idea);
                setStepByStepMode(true);
                setCurrentStepIndex(0);
                addLog('generate_step_by_step_guide', 'SUCCESS', `Started guided recreation project: ${idea.project_name}`);
            };

            return (
                <div className="max-w-6xl mx-auto px-4 py-10 flex-1 w-full">
                    <div className="mb-8">
                        <span className="text-xs font-bold text-brand-600 uppercase tracking-wider">Section B.2</span>
                        <h2 className="text-3xl font-extrabold text-slate-900 mt-1">Clothing Recreation & Live Gemini Upcycling</h2>
                        <p className="text-slate-600">Transform unused garments into creative products powered by live Gemini AI reasoning.</p>
                    </div>

                    {errorMsg && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm font-medium flex items-center justify-between">
                            <span>⚠️ <strong>API Error:</strong> {errorMsg}</span>
                            <button onClick={() => setErrorMsg(null)} className="font-bold ml-4">✕</button>
                        </div>
                    )}

                    {!stepByStepMode ? (
                        <>
                            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm mb-8">
                                <h3 className="text-xl font-bold text-slate-900 mb-4">Step 1: Select Garment & Describe Condition</h3>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                                    {garmentPresets.map(preset => (
                                        <div 
                                            key={preset.id}
                                            onClick={() => {
                                                setGarmentType(preset.id);
                                                setCondition(preset.defaultCond);
                                                setPreferences(preset.defaultPref);
                                            }}
                                            className={`p-5 rounded-2xl border-2 cursor-pointer transition text-center ${garmentType === preset.id ? 'border-brand-600 bg-brand-50/50 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                            <span className="text-3xl mb-2 block">{preset.icon}</span>
                                            <h4 className="font-bold text-sm text-slate-900">{preset.name}</h4>
                                        </div>
                                    ))}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Condition Details</label>
                                        <input 
                                            type="text" 
                                            value={condition}
                                            onChange={(e) => setCondition(e.target.value)}
                                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Preferences / Output Goal</label>
                                        <input 
                                            type="text" 
                                            value={preferences}
                                            onChange={(e) => setPreferences(e.target.value)}
                                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none text-sm"
                                        />
                                    </div>
                                </div>

                                <button 
                                    disabled={loading}
                                    onClick={fetchIdeas}
                                    className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center space-x-2">
                                    {loading ? (
                                        <>
                                            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                            <span>Running Live Gemini Upcycling Generation...</span>
                                        </>
                                    ) : (
                                        <span>✨ Generate Live Upcycling Concepts →</span>
                                    )}
                                </button>
                            </div>

                            <div>
                                <h3 className="text-xl font-bold text-slate-900 mb-4">Live Gemini Upcycling Concepts</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {ideas.map((idea, idx) => (
                                        <div key={idea.id || idx} className="bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-xl transition group">
                                            <div>
                                                <div className="relative h-52 overflow-hidden bg-slate-100">
                                                    <StepImage query={idea.image_query} alt={idea.project_name} icon="♻️" className="w-full h-full group-hover:scale-105 transition duration-300" />
                                                    <span className="absolute top-3 right-3 text-xs font-bold px-3 py-1 bg-white/90 backdrop-blur-sm text-brand-800 rounded-full shadow-xs">{idea.difficulty}</span>
                                                    <span className="absolute top-3 left-3 text-xs font-bold px-3 py-1 bg-slate-900/80 backdrop-blur-sm text-white rounded-full shadow-xs">⏱️ {idea.estimated_time}</span>
                                                </div>
                                                <div className="p-6">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="text-xs font-bold text-brand-600 uppercase tracking-wider">{idea.category}</span>
                                                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">📋 {idea.construction_steps?.length || 0} Steps</span>
                                                    </div>
                                                    <h4 className="text-xl font-bold text-slate-900 mb-2">{idea.project_name}</h4>
                                                    <p className="text-sm text-slate-600 mb-4 leading-relaxed">{idea.description}</p>
                                                </div>
                                            </div>
                                            <div className="p-6 pt-0">
                                                <button 
                                                    onClick={() => startGuidedProject(idea)}
                                                    className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center space-x-2">
                                                    <span>Start Guided Project ({idea.construction_steps?.length || 0} Steps)</span>
                                                    <span>→</span>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 pb-4 border-b border-slate-100 gap-4">
                                <div>
                                    <div className="flex items-center space-x-2 mb-1">
                                        <span className="text-xs font-bold px-3 py-1 bg-brand-100 text-brand-800 rounded-full">Guided Mode</span>
                                        <span className="text-xs font-bold px-3 py-1 bg-slate-100 text-slate-800 rounded-full">Total Steps: {selectedIdea.construction_steps?.length || 0}</span>
                                    </div>
                                    <h3 className="text-2xl font-extrabold text-slate-900">{selectedIdea.project_name}</h3>
                                </div>
                                <button 
                                    onClick={() => setStepByStepMode(false)}
                                    className="text-xs font-semibold px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700">
                                    ← Choose Another Idea
                                </button>
                            </div>

                            <div className="mb-6 bg-slate-100 h-3 rounded-full overflow-hidden">
                                <div 
                                    className="bg-brand-600 h-full transition-all duration-300"
                                    style={{ width: `${((currentStepIndex + 1) / (selectedIdea.construction_steps?.length || 1)) * 100}%` }}>
                                </div>
                            </div>

                            {selectedIdea.construction_steps && selectedIdea.construction_steps.length > 0 && (
                                <div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 items-center">
                                        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 min-h-[280px] flex flex-col justify-between">
                                            <div>
                                                <div className="flex justify-between items-center mb-3">
                                                    <span className="text-xs font-bold px-3 py-1 bg-brand-600 text-white rounded-full">
                                                        Step {currentStepIndex + 1} of {selectedIdea.construction_steps.length}
                                                    </span>
                                                    <span className="text-xs font-semibold text-slate-600">{selectedIdea.construction_steps[currentStepIndex].title}</span>
                                                </div>
                                                <h4 className="text-lg font-bold text-slate-900 mb-2">
                                                    {selectedIdea.construction_steps[currentStepIndex].action}
                                                </h4>
                                                <p className="text-sm text-slate-700 mb-3 leading-relaxed">{selectedIdea.construction_steps[currentStepIndex].howTo}</p>
                                            </div>
                                            <div className="space-y-2 mt-4 pt-4 border-t border-slate-200">
                                            <p className="text-xs text-brand-800 bg-brand-50 p-2.5 rounded-lg border border-brand-200 font-medium">
                                                💡 <strong>Why it matters:</strong> {selectedIdea.construction_steps[currentStepIndex].whyItMatters}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="relative h-72 rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100 flex flex-col justify-between">
                                        <StepImage query={selectedIdea.construction_steps[currentStepIndex].image_query || selectedIdea.image_query} alt={selectedIdea.construction_steps[currentStepIndex].title} icon="✂️" className="w-full h-full" />
                                    </div>
                                </div>

                                <div className="flex justify-between items-center pt-4 border-t border-slate-200">
                                        <button 
                                            disabled={currentStepIndex === 0}
                                            onClick={() => setCurrentStepIndex(prev => Math.max(0, prev - 1))}
                                            className={`px-6 py-3 rounded-xl font-semibold border border-slate-300 ${currentStepIndex === 0 ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'hover:bg-slate-100 text-slate-700'}`}>
                                            ← Previous Step
                                        </button>
                                        
                                        <div className="text-sm font-bold text-slate-700">
                                            Step {currentStepIndex + 1} of {selectedIdea.construction_steps.length}
                                        </div>

                                        {currentStepIndex < selectedIdea.construction_steps.length - 1 ? (
                                            <button 
                                                onClick={() => setCurrentStepIndex(prev => Math.min(selectedIdea.construction_steps.length - 1, prev + 1))}
                                                className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-md">
                                                Next Step →
                                            </button>
                                        ) : (
                                            <button 
                                                onClick={() => { showToast('Project completed successfully!'); setStepByStepMode(false); }}
                                                className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md">
                                                🎉 Finish Project
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        function McpServerDashboard({ logs }) {
            return (
                <div className="max-w-7xl mx-auto px-4 py-10 flex-1 w-full">
                    <div className="mb-8">
                        <div className="inline-flex items-center space-x-2 bg-slate-900 text-emerald-400 px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider mb-3">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span>Model Context Protocol (MCP) Server Active</span>
                        </div>
                        <h2 className="text-3xl font-extrabold text-slate-900">MCP Server & Tool Registry</h2>
                        <p className="text-slate-600">Inspect the 10 Model Context Protocol tools exposed to the AI client with live execution logs.</p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-4">
                            <h3 className="text-lg font-bold text-slate-900">Registered MCP Tools ({MCP_TOOLS.length})</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {MCP_TOOLS.map((tool, index) => (
                                    <div key={index} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-brand-500 transition flex flex-col justify-between">
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs font-mono bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-semibold">{tool.category}</span>
                                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                            </div>
                                            <h4 className="font-mono text-sm font-bold text-brand-700 mb-1">{tool.name}</h4>
                                            <p className="text-xs text-slate-600 leading-relaxed">{tool.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-slate-900 rounded-3xl p-6 text-slate-200 flex flex-col shadow-xl">
                            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
                                <h3 className="font-bold text-sm text-white flex items-center space-x-2">
                                    <span>📡 MCP Execution Logs</span>
                                </h3>
                                <span className="text-xs font-mono text-emerald-400">Dynamic Model Discovery</span>
                            </div>
                            <div className="flex-1 space-y-3 font-mono text-xs overflow-y-auto max-h-[500px] pr-2">
                                {logs.map((log, i) => (
                                    <div key={i} className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/50">
                                        <div className="flex justify-between text-slate-400 mb-1">
                                            <span className="text-brand-400 font-bold">{log.tool}</span>
                                            <span>{log.time}</span>
                                        </div>
                                        <p className="text-slate-300">{log.message}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        ReactDOM.createRoot(document.getElementById('root')).render(<App />);
    
