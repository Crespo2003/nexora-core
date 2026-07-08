import './globals.css';

export const metadata = {
  title: 'NEXORA V1',
  description: 'AI Real Estate Operating System'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
