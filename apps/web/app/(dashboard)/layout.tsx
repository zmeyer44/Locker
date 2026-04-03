import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { headers } from 'next/headers';
import { AppSidebar } from '@/components/app-sidebar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <AppSidebar user={session.user} />
      <div className="flex flex-1 p-2 pl-0">
        <main className="flex-1 overflow-auto rounded-lg border bg-background shadow-md">
          {children}
        </main>
      </div>
    </div>
  );
}
