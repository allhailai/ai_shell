import { useCallback, useEffect, useState } from "react";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import type { Assessment, CreateAssessmentInput } from "./types";
import { AssessmentList } from "./views/AssessmentList";
import { AssessmentWorkspace } from "./views/AssessmentWorkspace";
import { CreateAssessment } from "./views/CreateAssessment";

const APP_ID = "market-access";

/**
 * URL router for Market Access.
 *
 * Root React state holds in-memory assessments for this browser session only.
 * Refresh clears them. `assessments/new` is reserved before `:id`.
 */
export function MarketAccessContent() {
  const { segments, subPath, navigate, replace } = useAppSubRoute(APP_ID);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  useEffect(() => {
    const parts = subPath.split("/").filter(Boolean);

    if (parts.length === 0) {
      replace("assessments");
      return;
    }

    if (parts[0] !== "assessments") {
      setFlashMessage("That page is not available.");
      replace("assessments");
      return;
    }

    if (parts.length > 2) {
      const assessmentId = parts[1];
      if (assessmentId && assessmentId !== "new") {
        replace(`assessments/${assessmentId}`);
        return;
      }
      setFlashMessage("That page is not available.");
      replace("assessments");
      return;
    }

    if (parts.length === 2 && parts[1] !== "new") {
      const assessmentId = parts[1];
      if (!assessments.some((item) => item.id === assessmentId)) {
        setFlashMessage("Assessment not found — it is not saved yet.");
        replace("assessments");
      }
    }
  }, [subPath, replace, assessments]);

  const handleCreate = useCallback(
    (input: CreateAssessmentInput) => {
      const id = crypto.randomUUID();
      setAssessments((prev) => [
        ...prev,
        {
          id,
          productName: input.productName,
          packageFile: input.packageFile,
          createdAt: Date.now(),
        },
      ]);
      setFlashMessage(null);
      navigate(`assessments/${id}`);
    },
    [navigate],
  );

  const listView = (
    <AssessmentList
      assessments={assessments}
      flashMessage={flashMessage}
      onDismissFlash={() => setFlashMessage(null)}
      onCreate={() => {
        setFlashMessage(null);
        navigate("assessments/new");
      }}
      onOpen={(assessmentId) => {
        setFlashMessage(null);
        navigate(`assessments/${assessmentId}`);
      }}
    />
  );

  const section = segments[0] ?? "";
  const id = segments[1] ?? "";
  const activeAssessment =
    section === "assessments" && id && id !== "new"
      ? (assessments.find((item) => item.id === id) ?? null)
      : null;

  if (section === "" || (section === "assessments" && !id)) {
    return listView;
  }

  if (section === "assessments" && id === "new") {
    return (
      <CreateAssessment
        onCancel={() => {
          setFlashMessage(null);
          navigate("assessments");
        }}
        onCreate={handleCreate}
      />
    );
  }

  if (section === "assessments" && id && activeAssessment) {
    return <AssessmentWorkspace assessment={activeAssessment} />;
  }

  if (section === "assessments" && id) {
    // Unknown id — effect replaces to list; avoid flashing workspace shell.
    return listView;
  }

  return listView;
}
