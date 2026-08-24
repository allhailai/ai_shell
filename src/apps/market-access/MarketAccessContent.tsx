import { useEffect, useState } from "react";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { AssessmentList } from "./views/AssessmentList";
import { AssessmentWorkspace } from "./views/AssessmentWorkspace";
import { CreateAssessment } from "./views/CreateAssessment";

const APP_ID = "market-access";

/**
 * URL router for Market Access.
 *
 * `assessments/new` is reserved before `:id`. Unknown first segments
 * replace back to the list. Extra workspace segments are stripped to
 * overview — those routes are not implemented yet.
 */
export function MarketAccessContent() {
  const { segments, subPath, navigate, replace } = useAppSubRoute(APP_ID);
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
      const id = parts[1];
      if (id && id !== "new") {
        replace(`assessments/${id}`);
        return;
      }
      setFlashMessage("That page is not available.");
      replace("assessments");
    }
  }, [subPath, replace]);

  const section = segments[0] ?? "";
  const id = segments[1] ?? "";

  if (section === "" || (section === "assessments" && !id)) {
    return (
      <AssessmentList
        flashMessage={flashMessage}
        onDismissFlash={() => setFlashMessage(null)}
        onCreate={() => {
          setFlashMessage(null);
          navigate("assessments/new");
        }}
      />
    );
  }

  if (section === "assessments" && id === "new") {
    return (
      <CreateAssessment
        onCancel={() => {
          setFlashMessage(null);
          navigate("assessments");
        }}
      />
    );
  }

  if (section === "assessments" && id) {
    return <AssessmentWorkspace />;
  }

  return (
    <AssessmentList
      flashMessage={flashMessage}
      onDismissFlash={() => setFlashMessage(null)}
      onCreate={() => {
        setFlashMessage(null);
        navigate("assessments/new");
      }}
    />
  );
}
