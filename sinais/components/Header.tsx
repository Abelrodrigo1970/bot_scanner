'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const mainMenuItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/estrategias', label: 'Estratégias' },
  { href: '/historico', label: 'Histórico' },
  { href: '/relatorio', label: 'Relatório' },
  { href: '/resultados', label: 'Resultados' },
  { href: '/estatisticas', label: 'Estatísticas' },
  { href: '/analise', label: 'Análise' },
];

const dataSourceItems = [
  { href: '/top-movers', label: 'Top Voláteis' },
  { href: '/ma-cross-below', label: 'MA Cross Below' },
  { href: '/ma-30-above-6pct', label: 'MA30 > 9% MA200' },
  { href: '/ma-30-near-6-between', label: 'MA30 < −5% vs MA200 (1h)' },
  { href: '/bybit-ma200-mc20m', label: 'Bybit Volume 1h >500k e MA200 1h' },
];

export default function Header() {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dataSourceOpen, setDataSourceOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      router.push('/login');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  };

  return (
    <header className="bg-white dark:bg-gray-900 shadow-sm border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-4 md:space-x-8">
            <Link href="/" className="text-lg md:text-xl font-bold text-gray-900 dark:text-white">
              Crypto Sinais
            </Link>

            <nav className="hidden md:flex items-center space-x-1">
              {mainMenuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium"
                >
                  {item.label}
                </Link>
              ))}

              <div
                className="relative"
                onMouseEnter={() => setDataSourceOpen(true)}
                onMouseLeave={() => setDataSourceOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => setDataSourceOpen((o) => !o)}
                  className="flex items-center gap-1 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium"
                  aria-expanded={dataSourceOpen}
                  aria-haspopup="true"
                >
                  Origem de dados
                  <svg className="w-4 h-4 opacity-70" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {dataSourceOpen && (
                  <div className="absolute right-0 md:left-0 top-full z-50 pt-1 w-64">
                    <div className="bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-600 rounded-lg py-1 text-sm">
                      {dataSourceItems.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setDataSourceOpen(false)}
                          className="block px-4 py-2.5 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </nav>
          </div>

          <div className="flex items-center space-x-2 md:space-x-4">
            <button
              onClick={handleLogout}
              className="hidden md:block px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
            >
              Sair
            </button>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-md text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label="Menu"
            >
              <svg className="h-6 w-6" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? <path d="M6 18L18 6M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
              </svg>
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-800 pb-4">
            <nav className="px-2 pt-2 space-y-1">
              {mainMenuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {item.label}
                </Link>
              ))}
              <p className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Origem de dados</p>
              {dataSourceItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block pl-6 pr-3 py-2 rounded-md text-sm text-gray-600 dark:text-gray-300 border-l-2 border-violet-300 dark:border-violet-600 ml-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {item.label}
                </Link>
              ))}
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Sair
              </button>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
