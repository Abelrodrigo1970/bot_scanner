interface DirectionTagProps {
  direction: 'BUY' | 'SELL' | 'LONG' | 'SHORT';
}

export default function DirectionTag({ direction }: DirectionTagProps) {
  const isBuy = direction === 'BUY' || direction === 'LONG';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        isBuy
          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      }`}
    >
      {isBuy ? (direction === 'LONG' ? 'LONG' : 'COMPRA') : direction === 'SHORT' ? 'SHORT' : 'VENDA'}
    </span>
  );
}


