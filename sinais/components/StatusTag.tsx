interface StatusTagProps {
  status: string;
}

export default function StatusTag({ status }: StatusTagProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'NEW':
        return {
          label: 'Novo',
          className:
            'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        };
      case 'IN_PROGRESS':
        return {
          label: 'Em Andamento',
          className:
            'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        };
      case 'HIT_TARGET':
        return {
          label: 'Target Atingido',
          className:
            'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        };
      case 'HIT_STOP':
        return {
          label: 'Stop Atingido',
          className:
            'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        };
      case 'EXPIRED':
        return {
          label: 'Expirado',
          className:
            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
        };
      default:
        return {
          label: status,
          className:
            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
        };
    }
  };

  const config = getStatusConfig(status);

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}






