import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '交互模型数据合成管理平台',
  description: 'Local multitrack voice annotation workspace.',
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
