'use client';

import { useState } from 'react';
import {
  Users,
  Mail,
  Loader2,
  MoreHorizontal,
  Shield,
  UserMinus,
  XCircle,
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';

export default function MembersPage() {
  const workspace = useWorkspace();
  const utils = trpc.useUtils();
  const isAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  const { data: members } = trpc.members.list.useQuery();
  const { data: invites } = trpc.members.listInvites.useQuery(undefined, {
    enabled: isAdmin,
  });

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');

  const sendInvite = trpc.members.invite.useMutation({
    onSuccess: () => {
      utils.members.listInvites.invalidate();
      setInviteEmail('');
      toast.success('Invitation sent');
    },
    onError: (err) => toast.error(err.message),
  });

  const updateRole = trpc.members.updateRole.useMutation({
    onSuccess: () => {
      utils.members.list.invalidate();
      toast.success('Role updated');
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMember = trpc.members.removeMember.useMutation({
    onSuccess: () => {
      utils.members.list.invalidate();
      toast.success('Member removed');
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeInvite = trpc.members.revokeInvite.useMutation({
    onSuccess: () => {
      utils.members.listInvites.invalidate();
      toast.success('Invitation revoked');
    },
  });

  return (
    <div>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex flex-1 items-center gap-2 px-4">
          <Users className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Members</span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-8">
        {/* Invite section */}
        {isAdmin && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Invite members</h2>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!inviteEmail.trim()) return;
                sendInvite.mutate({ email: inviteEmail.trim(), role: inviteRole });
              }}
            >
              <Input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1"
              />
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'member' | 'admin')}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={sendInvite.isPending || !inviteEmail.trim()}>
                {sendInvite.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <>
                    <Mail />
                    Invite
                  </>
                )}
              </Button>
            </form>
          </div>
        )}

        {/* Pending invites */}
        {isAdmin && invites && invites.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Pending invitations</h2>
            <div className="rounded-lg border bg-card overflow-hidden divide-y">
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Invited by {invite.inviterName} &middot; {invite.role} &middot; Expires{' '}
                      {formatDate(invite.expiresAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => revokeInvite.mutate({ id: invite.id })}
                  >
                    <XCircle />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Members list */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            Members {members && `(${members.length})`}
          </h2>
          <div className="rounded-lg border bg-card overflow-hidden divide-y">
            {members?.map((member) => {
              const initials = member.userName
                ? member.userName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
                : member.userEmail[0]?.toUpperCase() ?? 'U';

              return (
                <div
                  key={member.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <Avatar className="size-8 rounded-lg">
                    {member.userImage && (
                      <AvatarImage src={member.userImage} alt={member.userName ?? ''} />
                    )}
                    <AvatarFallback className="rounded-lg text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {member.userName ?? member.userEmail.split('@')[0]}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {member.userEmail}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground capitalize px-2 py-1 bg-muted rounded-md">
                    {member.role}
                  </span>
                  {isAdmin && member.role !== 'owner' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            updateRole.mutate({
                              memberId: member.id,
                              role: member.role === 'admin' ? 'member' : 'admin',
                            })
                          }
                        >
                          <Shield />
                          Make {member.role === 'admin' ? 'member' : 'admin'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            if (confirm(`Remove ${member.userName ?? member.userEmail}?`)) {
                              removeMember.mutate({ memberId: member.id });
                            }
                          }}
                        >
                          <UserMinus />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
