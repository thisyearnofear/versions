import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyMessage } from "viem";

const { handlers, auth } = NextAuth({
  providers: [
    Credentials({
      name: "Wallet",
      credentials: {
        address: { label: "Address", type: "text" },
        signature: { label: "Signature", type: "text" },
        message: { label: "Message", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.address || !credentials?.signature || !credentials?.message) {
          return null;
        }

        const address = credentials.address as `0x${string}`;
        const signature = credentials.signature as `0x${string}`;
        const message = credentials.message as string;

        try {
          const valid = await verifyMessage({
            address,
            message,
            signature,
          });
          if (!valid) return null;
          return {
            id: address.toLowerCase(),
            name: address,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        (token as { walletAddress?: string }).walletAddress = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as { walletAddress?: string };
      if (session.user && t.walletAddress) {
        (session.user as { walletAddress?: string }).walletAddress = t.walletAddress;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});

export { handlers, auth };
