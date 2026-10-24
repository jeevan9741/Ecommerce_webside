import { CertificateViewer } from "@/components/certificates/certificate-viewer";
import { normaliseCertificateNo } from "@/lib/certificate/verify";

export default async function CertificatePage({ params }: { params: Promise<{ certificateNo: string }> }) {
  const { certificateNo } = await params;
  return <CertificateViewer certificateNo={normaliseCertificateNo(certificateNo)} />;
}
