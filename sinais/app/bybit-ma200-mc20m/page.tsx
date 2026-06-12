import { redirect } from 'next/navigation';

/** Scanner Bybit removido — redireciona para Scanner 1. */
export default function BybitMa200Mc20mRemovedPage() {
  redirect('/scanners/1');
}
