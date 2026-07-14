'use client';

export default function CommercialError({ reset }: { reset: () => void }) {
  return <main className="commercial-route-error"><h1>Commercial workspace unavailable / 商业工作区不可用</h1><p>The request could not be completed. No data was changed.<br/>请求无法完成，数据未被更改。</p><button onClick={reset}>Try again / 重试</button></main>;
}
