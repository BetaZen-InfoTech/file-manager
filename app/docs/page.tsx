import type { Metadata } from 'next';
import DocsClient from './DocsClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'API Documentation',
  description: 'REST API reference, live test portal, and Postman collection for File Manager SaaS.'
};

export default function DocsPage() {
  return <DocsClient />;
}
