import { HashRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { EXPECTED_CHAIN_NAME, isWrongNetwork, useWallet, WalletProvider } from "./lib/wallet";
import { fmtAddress } from "./lib/format";
import FlightsPage from "./pages/FlightsPage";
import MyPoliciesPage from "./pages/MyPoliciesPage";
import InsurerAdminPage from "./pages/InsurerAdminPage";

function NavBar() {
  const { address, connecting, error, connect, chainId } = useWallet();
  const loc = useLocation();
  const tab = (path: string, label: string) => (
    <Link to={path} className={loc.pathname === path ? "tab tab-active" : "tab"}>
      {label}
    </Link>
  );
  return (
    <header className="nav">
      <div className="nav-title">✈️ Flight Delay Insurance <span className="badge">demo</span></div>
      <nav className="tabs">
        {tab("/", "Flights & Buy")}
        {tab("/my-policies", "My Policies")}
        {tab("/admin", "Insurer Admin")}
      </nav>
      <div className="wallet">
        {address ? (
          <>
            {isWrongNetwork(chainId) && <span className="warn">Wrong network — switch to {EXPECTED_CHAIN_NAME}</span>}
            <span className="address">{fmtAddress(address)}</span>
          </>
        ) : (
          <button onClick={connect} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
        {error && <span className="warn">{error}</span>}
      </div>
    </header>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <HashRouter>
        <NavBar />
        <main className="content">
          <Routes>
            <Route path="/" element={<FlightsPage />} />
            <Route path="/my-policies" element={<MyPoliciesPage />} />
            <Route path="/admin" element={<InsurerAdminPage />} />
          </Routes>
        </main>
      </HashRouter>
    </WalletProvider>
  );
}
