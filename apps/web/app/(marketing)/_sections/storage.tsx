"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { HardDriveIcon } from "lucide-react";
import { FolderSvg } from "../_components/folder-svg";

const providers = [
  {
    name: "Local Filesystem",
    env: "local",
    description: "Store files directly on your server. Zero config, zero cost.",
    logo: null,
    icon: <HardDriveIcon className="size-6" />,
  },
  {
    name: "AWS S3",
    env: "s3",
    description:
      "The industry standard. Reliable, scalable, globally distributed.",
    logo: "/assets/provider-logos/aws.svg",
    icon: null,
  },
  {
    name: "Cloudflare R2",
    env: "r2",
    description:
      "S3-compatible with zero egress fees. Great for bandwidth-heavy workloads.",
    logo: "/assets/provider-logos/cloudflare-icon.svg",
    icon: null,
  },
  {
    name: "Vercel Blob",
    env: "vercel",
    description:
      "Serverless-native storage. One token, no infrastructure to manage.",
    logo: "/assets/provider-logos/vercel-icon.svg",
    icon: null,
  },
];

export function Storage() {
  return (
    <section id="storage" className="flex flex-col bg-muted">
      <div className="grid-layout w-full py-20">
        <motion.div
          className="col-span-full mb-10"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
        >
          <p className="mkt-label text-primary">Bring your own backend</p>
          <h2 className="mkt-heading mt-2 text-foreground">
            One env var. Any storage provider.
          </h2>
          <p className="mkt-body mt-4 max-w-2xl text-balance text-muted-foreground">
            Set{" "}
            <code className="rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-sm">
              BLOB_STORAGE_PROVIDER
            </code>{" "}
            in your{" "}
            <code className="rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-sm">
              .env
            </code>{" "}
            and you&apos;re done. Switch providers anytime without touching a
            line of code.
          </p>
        </motion.div>

        {providers.map((provider, index) => (
          <motion.div
            key={provider.name}
            className="col-span-full md:col-span-6 lg:col-span-3"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: index * 0.08 }}
          >
            <div
              className={cn(
                "flex h-full flex-col rounded-xl border border-border bg-background p-6",
                "transition-all duration-300 hover:border-primary/30 hover:shadow-sm",
              )}
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {provider.logo ? (
                  <Image
                    src={provider.logo}
                    alt={provider.name}
                    width={24}
                    height={24}
                    className="size-6 dark:invert"
                  />
                ) : (
                  provider.icon
                )}
              </div>
              <h3 className="mkt-subheading mt-4 text-foreground">
                {provider.name}
              </h3>
              <p className="mkt-body-sm mt-1.5 flex-1 text-muted-foreground">
                {provider.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="w-full">
        <div className="grid-layout relative">
          <div className="col-span-full flex justify-start">
            <FolderSvg className="text-mkt-dark" />
          </div>
        </div>
      </div>
    </section>
  );
}
