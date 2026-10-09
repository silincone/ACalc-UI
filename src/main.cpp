#include <emscripten/bind.h>
#include "core.h"

using namespace emscripten;
using namespace ACalcCore;

EMSCRIPTEN_BINDINGS(acalc_module) {
    function("validateSubjectName",       &validateSubjectName);
    function("validateDesiredPercentage", &validateDesiredPercentage);
    function("validateClassesCount",      &validateClassesCount);

    constant("DESIRED_PERCENTAGE",     DESIRED_PERCENTAGE);
    constant("MIN_DESIRED_PERCENTAGE", MIN_DESIRED_PERCENTAGE);
    constant("MAX_DESIRED_PERCENTAGE", MAX_DESIRED_PERCENTAGE);
    constant("MAX_CLASSES",            MAX_CLASSES);

    enum_<ErrorCodes>("ErrorCodes")
        .value("CCZ",   ErrorCodes::CCZ)
        .value("CAGCC", ErrorCodes::CAGCC)
        .value("ESN",   ErrorCodes::ESN)
        .value("SAP",   ErrorCodes::SAP)
        .value("SNP",   ErrorCodes::SNP)
        .value("IDP",   ErrorCodes::IDP)
        .value("CCTL",  ErrorCodes::CCTL);
    
    value_object<Metrics>("Metrics")
        .field("requiredPercentage", &Metrics::requiredPercentage)
        .field("excessPercentage",   &Metrics::excessPercentage)
        .field("classesNeeded",      &Metrics::classesNeeded)
        .field("classesOverflow",    &Metrics::classesOverflow);

    value_object<OperationResult>("OperationResult")
        .field("status",  &OperationResult::status)
        .field("code",    &OperationResult::code)
        .field("message", &OperationResult::message);

    value_object<MetricsResult>("MetricsResult")
        .field("status",  &MetricsResult::status)
        .field("code",    &MetricsResult::code)
        .field("message", &MetricsResult::message)
        .field("metrics", &MetricsResult::metrics);

    register_vector<Subject>("VectorSubject");

    class_<Subject>("Subject")
        .function("subjectName",        &Subject::subjectName)
        .function("currentPercentage",  &Subject::currentPercentage)
        .function("classesAttended",    &Subject::classesAttended)
        .function("classesConducted",   &Subject::classesConducted)
        .function("requiredPercentage", &Subject::requiredPercentage)
        .function("excessPercentage",   &Subject::excessPercentage)
        .function("classesNeeded",      &Subject::classesNeeded)
        .function("classOverflow",      &Subject::classOverflow);

    class_<AttendanceRegister>("AttendanceRegister")
        .constructor<>()
        .function("insert",               &AttendanceRegister::insert)
        .function("edit",                 &AttendanceRegister::edit)
        .function("remove",               &AttendanceRegister::remove)
        .function("clear",                &AttendanceRegister::clear)
        .function("subjects",             &AttendanceRegister::subjects)
        .function("metricsFor",           &AttendanceRegister::metricsFor)
        .function("setDesiredPercentage", &AttendanceRegister::desiredPercentage);
}